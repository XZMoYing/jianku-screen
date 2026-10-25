import AppKit
import Foundation

setbuf(stdout, nil)
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let controlPath = CommandLine.arguments[1]
let screen = NSScreen.screens[0]
let backdrop = NSWindow(contentRect: screen.visibleFrame, styleMask: [.borderless], backing: .buffered, defer: false)
backdrop.backgroundColor = NSColor(calibratedRed: 0.16, green: 0.17, blue: 0.22, alpha: 1)
backdrop.title = "Jianku Synthetic Backdrop"
backdrop.orderFront(nil)

final class TargetView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedRed: 0.12, green: 0.62, blue: 0.32, alpha: 1).setFill()
        bounds.fill()
        NSColor.white.setFill()
        NSRect(x: bounds.midX - 20, y: bounds.midY - 20, width: 40, height: 40).fill()
        NSColor.black.setFill()
        NSRect(x: 20, y: 20, width: 20, height: 20).fill()
    }
}

let target = NSWindow(contentRect: NSRect(x: 160, y: 180, width: 720, height: 450), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
target.title = "Jianku Window Capture Fixture"
target.contentView = TargetView()
let originalFrame = target.frame
let cover = NSWindow(contentRect: target.frame, styleMask: [.borderless], backing: .buffered, defer: false)
cover.backgroundColor = NSColor(calibratedRed: 0.86, green: 0.12, blue: 0.10, alpha: 1)
cover.level = .floating
cover.title = "Jianku Synthetic Occluder"
var previousCommand = ""

func centerCursor() {
    let point = target.convertPoint(toScreen: NSPoint(x: target.contentView!.bounds.midX, y: target.contentView!.bounds.midY))
    CGWarpMouseCursorPosition(CGPoint(x: point.x, y: screen.frame.maxY - point.y))
}

func report(_ action: String) {
    let f = target.frame
    print("{\"action\":\"\(action)\",\"windowId\":\(target.windowNumber),\"x\":\(f.minX),\"y\":\(screen.frame.maxY-f.maxY),\"width\":\(f.width),\"height\":\(f.height)}")
}

let timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
    guard let command = try? String(contentsOfFile: controlPath, encoding: .utf8), command != previousCommand else { return }
    previousCommand = command
    let action = command.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: ":")[0]
    switch action {
    case "prepare":
        cover.orderOut(nil)
        target.setFrame(originalFrame, display: true)
        target.makeKeyAndOrderFront(nil)
        centerCursor()
    case "cover":
        cover.setFrame(target.frame, display: true)
        cover.orderFrontRegardless()
    case "uncover":
        cover.orderOut(nil)
        target.makeKeyAndOrderFront(nil)
        centerCursor()
    case "move":
        cover.orderOut(nil)
        target.setFrameOrigin(NSPoint(x: originalFrame.minX + 240, y: originalFrame.minY + 90))
        centerCursor()
    case "resize":
        target.setContentSize(NSSize(width: 360, height: 600))
        target.contentView?.needsDisplay = true
        centerCursor()
    case "quit":
        app.terminate(nil)
    default:
        break
    }
    report(action)
}
target.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
centerCursor()
report("ready")
app.run()
