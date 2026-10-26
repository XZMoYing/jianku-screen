import AVFoundation
import CoreVideo
import CryptoKit
import Foundation

func probe(_ path: String, _ start: CMTime, _ target: Double) throws -> [String: Any] {
    let began = ProcessInfo.processInfo.systemUptime
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = asset.tracks(withMediaType: .video).first else { throw NSError(domain: "missing track", code: 1) }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: start, duration: .positiveInfinity)
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
    let index = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path.replacingOccurrences(of: ".mp4", with: ".index.json")))) as! [String:Any]
    let base = ((index["streams"] as! [[String:Any]])[0]["time_base"] as! String).split(separator:"/").map{Int64($0)!}
    let points = (index["packets"] as! [[String:Any]]).compactMap{$0["pts"] as? Int64}.sorted()
    for time in [0, 0.00001, 1.0 / 60, 0.3 - 0.00005, 0.3, 0.3 + 0.00005, 1.017, duration-0.5, duration-0.00001] {
        let baseline = try probe(path, .zero, time)
        let selected = points.first{Double($0 * base[0]) / Double(base[1]) + 0.0001 >= time} ?? points.last!
        let direct = try probe(path, CMTime(value:selected * base[0],timescale:Int32(base[1])), time)
        results.append(["path":path,"target":time,"baseline":baseline,"direct":direct])
    }
}
let json = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(json)
