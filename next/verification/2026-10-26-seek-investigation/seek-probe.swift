import AVFoundation
import CoreVideo
import CryptoKit
import Foundation

func probe(_ path: String, _ start: Double, _ target: Double) throws -> [String: Any] {
    let began = ProcessInfo.processInfo.systemUptime
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = asset.tracks(withMediaType: .video).first else { throw NSError(domain: "missing track", code: 1) }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: max(0, start), preferredTimescale: 600000), duration: .positiveInfinity)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else { throw reader.error! }
    var count = 0
    var last: CMSampleBuffer? = nil
    while let sample = output.copyNextSampleBuffer() {
        count += 1
        last = sample
        if CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) + 0.0001 >= target { break }
    }
    guard let sample = last, let image = CMSampleBufferGetImageBuffer(sample) else { return ["samples":count, "empty":true] }
    var digest = SHA256()
    CVPixelBufferLockBaseAddress(image, .readOnly)
    for plane in 0..<CVPixelBufferGetPlaneCount(image) {
        let address = CVPixelBufferGetBaseAddressOfPlane(image, plane)!
        let stride = CVPixelBufferGetBytesPerRowOfPlane(image, plane)
        let height = CVPixelBufferGetHeightOfPlane(image, plane)
        let width = CVPixelBufferGetWidth(image)
        for row in 0..<height { digest.update(data: Data(bytes: address.advanced(by: row * stride), count: width)) }
    }
    CVPixelBufferUnlockBaseAddress(image, .readOnly)
    reader.cancelReading()
    return ["samples":count,"pts":CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)),"hash":digest.finalize().map{String(format:"%02x",$0)}.joined(),"ms":(ProcessInfo.processInfo.systemUptime-began)*1000]
}
var results: [[String:Any]] = []
for path in CommandLine.arguments.dropFirst() {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    let duration = CMTimeGetSeconds(asset.duration)
    for time in [0, 0.00001, 1.0 / 60, 0.3 - 0.00005, 0.3, 0.3 + 0.00005, 1.017, duration-0.5, duration-0.00001] {
        let baseline = try probe(path, 0, time)
        let direct = try probe(path, time - 0.0001, time)
        results.append(["path":path,"target":time,"baseline":baseline,"direct":direct])
    }
}
let json = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(json)
