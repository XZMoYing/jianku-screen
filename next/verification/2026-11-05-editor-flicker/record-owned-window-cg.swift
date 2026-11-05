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
  catch { print("Owned-window capture stopped: \(error)"); exit(2) }
 }
 @MainActor static func run() async throws {
  _ = NSApplication.shared
  let args = CommandLine.arguments
  guard args.count == 4, let windowID = UInt32(args[1]), let duration = Double(args[2]), duration >= 3, duration <= 30,
   args[3].hasPrefix("/private/tmp/jianku-editor-flicker-20261105/"), !FileManager.default.fileExists(atPath: args[3]), AXIsProcessTrusted() else { throw NSError(domain: "Invalid owned capture arguments", code: 2) }
  let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next").filter { $0.bundleURL?.path == "/Applications/Jianku Screen Next.app" }
  guard apps.count == 1, let app = apps.first else { throw NSError(domain: "Expected one installed app", code: 2) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  func read(_ node: AXUIElement, _ key: String) -> CFTypeRef? { var out: CFTypeRef?; return AXUIElementCopyAttributeValue(node, key as CFString, &out) == .success ? out : nil }
  let windows = (read(root, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { (read($0, kAXTitleAttribute) as? String)?.contains("视频编辑") == true }
  guard windows.count == 1 else { throw NSError(domain: "Expected unique editor", code: 2) }
  var owned = false
  func inspect(_ node: AXUIElement, _ depth: Int) {
   guard depth < 35 else { return }
   if read(node, kAXRoleAttribute) as? String == "AXTextField", let value = read(node, kAXValueAttribute) as? String, value.hasPrefix("拖动与缩放验收") { owned = true }
   for child in read(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] { inspect(child, depth + 1) }
  }
  inspect(windows[0], 0)
  guard owned else { throw NSError(domain: "Preserve unknown editor contents", code: 2) }
  func ownWindow() -> [String: Double]? {
   let list = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]] ?? []
   return list.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == windowID && ($0[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier && ($0[kCGWindowName as String] as? String)?.contains("视频编辑") == true })?[kCGWindowBounds as String] as? [String: Double]
  }
  guard let bounds = ownWindow(), let pointsWide = bounds["Width"], let pointsHigh = bounds["Height"] else { throw NSError(domain: "Owned window changed", code: 2) }
  let width = Int(ceil(pointsWide / 2)) * 2
  let height = Int(ceil(pointsHigh / 2)) * 2
  let recorder = try WindowRecorder(output: URL(fileURLWithPath: args[3]), width: width, height: height)
  print("OWNED_WINDOW_CAPTURE_READY \(windowID) \(width)x\(height)"); fflush(stdout)
  let startedUnix = Date().timeIntervalSince1970
  let started = ProcessInfo.processInfo.systemUptime
  var firstSampleUnix: Double?
  var previous: Double?
  var maxGap = 0.0
  var samples = 0
  while ProcessInfo.processInfo.systemUptime - started < duration {
   guard ownWindow() == bounds else { throw NSError(domain: "Owned window geometry changed during capture", code: 2) }
   let captured = autoreleasepool { () -> Bool in
    guard let image = CGWindowListCreateImage(.null, .optionIncludingWindow, windowID, [.boundsIgnoreFraming, .nominalResolution]) else { return false }
    let now = ProcessInfo.processInfo.systemUptime
    if let previous { maxGap = max(maxGap, now - previous) }
    previous = now
    if firstSampleUnix == nil { firstSampleUnix = startedUnix + now - started }
    samples += 1
    recorder.append(image, at: CMTime(seconds: now - started, preferredTimescale: 1_000_000))
    return true
   }
   guard captured else { throw NSError(domain: "Owned window image unavailable", code: 2) }
   try await Task.sleep(nanoseconds: 5_000_000)
  }
  recorder.input.markAsFinished()
  await recorder.writer.finishWriting()
  guard recorder.writer.status == .completed, !recorder.appendFailed, recorder.frames > 0 else { throw recorder.writer.error ?? NSError(domain: "Owned capture did not finish", code: 2) }
  let report: [String: Any] = ["scope": "CGWindowListCreateImage optionIncludingWindow for one verified owned editor; no display capture", "windowID": windowID, "width": width, "height": height, "frames": recorder.frames, "samples": samples, "captureStartedAtUnix": startedUnix, "firstSampleAtUnix": firstSampleUnix ?? startedUnix, "maximumSampleGapMs": maxGap * 1000, "droppedByWriter": recorder.dropped, "durationRequested": duration]
  print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
 }
}
