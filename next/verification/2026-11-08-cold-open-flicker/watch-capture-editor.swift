import AppKit
import ApplicationServices
import AVFoundation
import CoreMedia
import CoreGraphics

final class WindowRecorder: NSObject {
 let writer: AVAssetWriter
 let input: AVAssetWriterInput
 let adaptor: AVAssetWriterInputPixelBufferAdaptor
 var firstTime: CMTime?
 var frames = 0
 var dropped = 0
 var appendFailed = false
 init(output: URL, width: Int, height: Int) throws {
  writer = try AVAssetWriter(outputURL: output, fileType: .mov)
  input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 24_000_000, AVVideoMaxKeyFrameIntervalKey: 60]])
  input.expectsMediaDataInRealTime = true
  adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
  super.init()
  guard writer.canAdd(input) else { throw NSError(domain: "Cannot add owned-window video input", code: 2) }
  writer.add(input)
  guard writer.startWriting() else { throw writer.error ?? NSError(domain: "Cannot start owned-window writer", code: 2) }
 }
 func append(_ image: CGImage, at timestamp: CMTime) {
  guard input.isReadyForMoreMediaData else { dropped += 1; return }
  if firstTime == nil { firstTime = timestamp; writer.startSession(atSourceTime: .zero) }
  guard let firstTime, let pool = adaptor.pixelBufferPool else { appendFailed = true; return }
  var pixel: CVPixelBuffer?
  guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixel) == kCVReturnSuccess, let pixel else { appendFailed = true; return }
  CVPixelBufferLockBaseAddress(pixel, [])
  defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
  guard let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: CVPixelBufferGetWidth(pixel), height: CVPixelBufferGetHeight(pixel), bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { appendFailed = true; return }
  context.draw(image, in: CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(pixel), height: CVPixelBufferGetHeight(pixel)))
  if adaptor.append(pixel, withPresentationTime: CMTimeSubtract(timestamp, firstTime)) { frames += 1 }
  else { appendFailed = true }
 }
}

@main struct Main {
 static func main() async {
  do { try await run() }
  catch { print("Watch capture stopped: \(error)"); exit(2) }
 }
 @MainActor static func run() async throws {
  _ = NSApplication.shared
  let args = CommandLine.arguments
  guard args.count == 4, let duration = Double(args[1]), duration >= 2, duration <= 20,
   args[2].hasPrefix("/private/tmp/jianku-flicker-20261108/"), !FileManager.default.fileExists(atPath: args[2]),
   args[3] == "com.jianku.screen.next" else { throw NSError(domain: "Invalid watch capture arguments", code: 2) }
  let apps = NSRunningApplication.runningApplications(withBundleIdentifier: args[3]).filter { $0.bundleURL?.path == "/Applications/Jianku Screen Next.app" }
  guard apps.count == 1, let app = apps.first else { throw NSError(domain: "Expected one installed app", code: 2) }
  var found: (id: UInt32, bounds: [String: Double])?
  let waitStarted = ProcessInfo.processInfo.systemUptime
  while found == nil {
   if ProcessInfo.processInfo.systemUptime - waitStarted > 25 { throw NSError(domain: "No editor window appeared", code: 2) }
   let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
   for info in list {
    guard (info[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier,
     let name = info[kCGWindowName as String] as? String, name.contains("视频编辑"),
     let number = info[kCGWindowNumber as String] as? UInt32,
     let bounds = info[kCGWindowBounds as String] as? [String: Double],
     let w = bounds["Width"], let h = bounds["Height"], w > 200, h > 200
    else { continue }
    found = (number, bounds)
    break
   }
   if found == nil { try await Task.sleep(nanoseconds: 5_000_000) }
  }
  guard let found else { throw NSError(domain: "Editor window vanished", code: 2) }
  let width = Int(ceil(found.bounds["Width"]! / 2)) * 2
  let height = Int(ceil(found.bounds["Height"]! / 2)) * 2
  let recorder = try WindowRecorder(output: URL(fileURLWithPath: args[2]), width: width, height: height)
  let firstSeenUnix = Date().timeIntervalSince1970
  let started = ProcessInfo.processInfo.systemUptime
  var previous: Double?
  var maxGap = 0.0
  var samples = 0
  print("WATCH_CAPTURE_READY \(found.id) \(width)x\(height)"); fflush(stdout)
  while ProcessInfo.processInfo.systemUptime - started < duration {
   guard let image = CGWindowListCreateImage(.null, .optionIncludingWindow, found.id, [.boundsIgnoreFraming, .nominalResolution]) else { throw NSError(domain: "Image unavailable", code: 2) }
   let now = ProcessInfo.processInfo.systemUptime
   if let previous { maxGap = max(maxGap, now - previous) }
   previous = now
   samples += 1
   recorder.append(image, at: CMTime(seconds: now - started, preferredTimescale: 1_000_000))
   try await Task.sleep(nanoseconds: 5_000_000)
  }
  recorder.input.markAsFinished()
  await recorder.writer.finishWriting()
  guard recorder.writer.status == .completed, !recorder.appendFailed, recorder.frames > 0 else { throw recorder.writer.error ?? NSError(domain: "Watch capture did not finish", code: 2) }
  let report: [String: Any] = ["windowID": found.id, "width": width, "height": height, "frames": recorder.frames, "samples": samples, "durationRequested": duration, "firstSeenAtUnix": firstSeenUnix, "captureStartedAtUnix": firstSeenUnix, "maximumSampleGapMs": maxGap * 1000, "droppedByWriter": recorder.dropped]
  print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
 }
}
