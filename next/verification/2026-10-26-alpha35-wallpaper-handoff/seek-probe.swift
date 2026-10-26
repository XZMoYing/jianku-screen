import AVFoundation
import CoreVideo
import CryptoKit
import Foundation
let path = CommandLine.arguments[1]
let target = Double(CommandLine.arguments[2])!
func sample(start: Double) throws -> [String: Any] {
    let clock = CFAbsoluteTimeGetCurrent()
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: asset.tracks(withMediaType: .video)[0], outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600000), duration: .positiveInfinity)
    guard reader.startReading() else { throw reader.error! }
    var count = 0
    while let sample = output.copyNextSampleBuffer() {
        count += 1
        let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        if pts + 0.0001 < target { continue }
        let image = CMSampleBufferGetImageBuffer(sample)!
        CVPixelBufferLockBaseAddress(image, .readOnly)
        var digest = SHA256()
        for plane in 0..<CVPixelBufferGetPlaneCount(image) {
            let address = CVPixelBufferGetBaseAddressOfPlane(image, plane)!
            let stride = CVPixelBufferGetBytesPerRowOfPlane(image, plane)
            let width = CVPixelBufferGetWidth(image)
            let height = CVPixelBufferGetHeightOfPlane(image, plane)
            for row in 0..<height { digest.update(data: Data(bytes: address.advanced(by: row * stride), count: width)) }
        }
        CVPixelBufferUnlockBaseAddress(image, .readOnly)
        reader.cancelReading()
        return ["rangeStart": start, "requested": target, "pts": pts, "samples": count, "elapsedMs": (CFAbsoluteTimeGetCurrent()-clock)*1000, "hash": digest.finalize().map { String(format: "%02x", $0) }.joined()]
    }
    throw reader.error ?? NSError(domain: "Missing frame", code: 1)
}
let result = try [sample(start: 0), sample(start: target)]
print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
