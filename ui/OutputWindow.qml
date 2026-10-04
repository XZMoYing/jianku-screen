import QtQuick
import QtQuick.Controls
import Jianku.Screen

Window {
    id: output
    objectName: "audienceWindow"
    visible: false
    width: 1280
    height: 720
    minimumWidth: 480
    minimumHeight: 270
    title: "简库镜传 — 演示输出"
    color: "#0d0d0f"

    // A Window declared inside another Window becomes its transient child, and on macOS a
    // child window cannot go full-screen on a *different* display: it gets pulled back to
    // the parent's screen. That is exactly the reported bug — choosing "输出到 2410C" put
    // the output on the built-in display instead.
    //
    // Measured on Qt 6.11.2: the inner Window reports `transientParent == 主窗口` unless
    // this is set, and `null` when it is. The recording HUD already did this; the output
    // window was simply missed.
    transientParent: null

    PreviewCanvas {
        anchors.fill: parent
        live: capture.running
        showStageShadow: false
        stageMargin: 0
    }

    Label {
        anchors.centerIn: parent
        text: "等待屏幕画面"
        color: Theme.textFaint
        visible: !capture.running
    }
}
