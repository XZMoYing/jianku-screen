import AppKit
import AVFoundation
import CoreMediaIO
import Foundation

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}

func connectedDevices() -> [AVCaptureDevice] {
    var address = CMIOObjectPropertyAddress(
        mSelector: UInt32(kCMIOHardwarePropertyAllowScreenCaptureDevices),
        mScope: UInt32(kCMIOObjectPropertyScopeGlobal),
        mElement: UInt32(kCMIOObjectPropertyElementMain)
    )
    var enabled: UInt32 = 1
    CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil,
                             UInt32(MemoryLayout<UInt32>.size), &enabled)
    let allDevices: [AVCaptureDevice]
    if #available(macOS 14.0, *) {
        allDevices = AVCaptureDevice.DiscoverySession(deviceTypes: [.external], mediaType: nil,
                                                       position: .unspecified).devices
    } else {
        allDevices = AVCaptureDevice.DiscoverySession(deviceTypes: [.externalUnknown], mediaType: nil,
                                                       position: .unspecified).devices
    }
    return allDevices.filter { device in
        let model = device.modelID.lowercased()
        return device.hasMediaType(.muxed) && (
            ["ipad", "iphone", "ipod", "ios"].contains { model.contains($0) }
            || device.manufacturer.lowercased().contains("apple")
        )
    }
}

final class Recorder: NSObject, AVCaptureFileOutputRecordingDelegate, NSWindowDelegate {
    private let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private var previewWindow: NSWindow?
    private var stopping = false
    private var started = false
    private var disconnected: NSObjectProtocol?
    private var startTimeout: Timer?
    private var stopTimeout: Timer?

    func record(device: AVCaptureDevice, path: String, audio: Bool, preview: Bool) throws {
        let authorization = AVCaptureDevice.authorizationStatus(for: .video)
        if authorization == .notDetermined {
            let permission = DispatchSemaphore(value: 0)
            AVCaptureDevice.requestAccess(for: .video) { _ in permission.signal() }
            permission.wait()
        }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            throw NSError(domain: "JiankuDevice", code: 4, userInfo: [NSLocalizedDescriptionKey:
                "请在系统设置 → 隐私与安全性 → 相机中允许简库访问设备画面。"])
        }
        session.beginConfiguration()
        if session.canSetSessionPreset(.high) { session.sessionPreset = .high }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "JiankuDevice", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "无法连接设备画面，请解锁并信任这台 Mac。"])
        }
        session.addInput(input)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "JiankuDevice", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "设备暂不支持视频录制。"])
        }
        session.addOutput(output)
        if let connection = output.connection(with: .audio) { connection.isEnabled = audio }
        session.commitConfiguration()
        disconnected = NotificationCenter.default.addObserver(
            forName: AVCaptureDevice.wasDisconnectedNotification, object: device, queue: .main
        ) { [weak self] _ in
            emit(["event": "disconnected", "message": "设备已断开，正在保存已录制的画面。"])
            self?.stop()
        }
        if preview {
            NSApplication.shared.setActivationPolicy(.accessory)
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 600),
                                  styleMask: [.titled, .closable, .resizable, .miniaturizable],
                                  backing: .buffered, defer: false)
            window.title = "简库设备预览"
            window.delegate = self
            window.isReleasedWhenClosed = false
            window.contentView?.wantsLayer = true
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspect
            layer.frame = window.contentView!.bounds
            layer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
            window.contentView?.layer?.backgroundColor = NSColor.black.cgColor
            window.contentView?.layer?.addSublayer(layer)
            window.center()
            window.makeKeyAndOrderFront(nil)
            previewWindow = window
        }
        session.startRunning()
        output.startRecording(to: URL(fileURLWithPath: path), recordingDelegate: self)
        startTimeout = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            guard let self = self, !self.started else { return }
            emit(["event": "error", "message": "设备未传来画面，请解锁设备并确认 USB 信任。"])
            self.stop()
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                if line == "stop" {
                    DispatchQueue.main.async { self?.stop() }
                    return
                }
            }
            DispatchQueue.main.async { self?.stop() }
        }
    }

    func windowWillClose(_ notification: Notification) { stop() }

    func stop() {
        guard !stopping else { return }
        stopping = true
        startTimeout?.invalidate()
        if output.isRecording {
            output.stopRecording()
            stopTimeout = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { _ in
                emit(["event": "error", "message": "保存设备录制超时，原始文件已保留。"])
                exit(3)
            }
        } else {
            session.stopRunning()
            emit(["event": "error", "message": "设备尚未开始录制。"])
            exit(2)
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL,
                    from connections: [AVCaptureConnection]) {
        DispatchQueue.main.async {
            self.started = true
            self.startTimeout?.invalidate()
            emit(["event": "started"])
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo fileURL: URL,
                    from connections: [AVCaptureConnection], error: Error?) {
        DispatchQueue.main.async {
            self.stopTimeout?.invalidate()
            self.session.stopRunning()
            if let error = error as NSError?,
               !(error.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false) {
                emit(["event": "error", "message": error.localizedDescription])
                exit(2)
            }
            emit(["event": "finished"])
            exit(0)
        }
    }
}

let args = CommandLine.arguments
let devices = connectedDevices()
if args.count == 2 && args[1] == "list" {
    emit(["devices": devices.map { ["id": $0.uniqueID, "name": $0.localizedName,
                                    "audio": $0.hasMediaType(.audio) || $0.hasMediaType(.muxed)] }])
    exit(0)
}
guard args.count == 6, args[1] == "record",
      let device = devices.first(where: { $0.uniqueID == args[2] }) else {
    emit(["event": "error", "message": "未找到 iPhone 或 iPad，请连接 USB、解锁并信任这台 Mac。"])
    exit(2)
}
let recorder = Recorder()
do {
    try recorder.record(device: device, path: args[3], audio: args[4] == "true", preview: args[5] == "true")
    if args[5] == "true" { NSApplication.shared.run() } else { RunLoop.main.run() }
} catch {
    emit(["event": "error", "message": error.localizedDescription])
    exit(2)
}
