import Foundation
import AVFoundation
import CoreVideo

@main
struct Probe {
    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        for name in ["display", "camera"] {
            for variant in ["sized", "native"] {
                let asset = AVURLAsset(url: root.appendingPathComponent("media/\(name).mp4"))
                let track = try await asset.loadTracks(withMediaType: .video)[0]
                let size = try await track.load(.naturalSize)
                let reader = try AVAssetReader(asset: asset)
                var settings: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
                if variant == "sized" {
                    settings[kCVPixelBufferWidthKey as String] = Int(size.width)
                    settings[kCVPixelBufferHeightKey as String] = Int(size.height)
                }
                let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
                output.alwaysCopiesSampleData = false
                reader.add(output)
                reader.startReading()
                let directory = root.appendingPathComponent("swift-\(variant)-\(name)")
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                var samples: [[String: Any]] = []
                var index = 0
                while let sample = output.copyNextSampleBuffer(), index < 110 {
                    guard let image = CMSampleBufferGetImageBuffer(sample) else { fatalError("Missing image") }
                    CVPixelBufferLockBaseAddress(image, .readOnly)
                    let width = CVPixelBufferGetWidth(image)
                    let height = CVPixelBufferGetHeight(image)
                    for plane in 0..<2 {
                        let stride = CVPixelBufferGetBytesPerRowOfPlane(image, plane)
                        let rows = CVPixelBufferGetHeightOfPlane(image, plane)
                        let base = CVPixelBufferGetBaseAddressOfPlane(image, plane)!
                        var data = Data()
                        for row in 0..<rows { data.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width) }
                        try data.write(to: directory.appendingPathComponent("\(index)-\(plane).bin"))
                    }
                    CVPixelBufferUnlockBaseAddress(image, .readOnly)
                    samples.append(["index": index, "pts": CMSampleBufferGetPresentationTimeStamp(sample).seconds, "width": width, "height": height])
                    index += 1
                }
                reader.cancelReading()
                try JSONSerialization.data(withJSONObject: samples, options: [.sortedKeys, .prettyPrinted]).write(to: directory.appendingPathComponent("samples.json"))
                print(name, variant, index)
            }
        }
    }
}
