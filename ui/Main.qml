import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Jianku.Screen

ApplicationWindow {
    id: root
    visible: true
    width: 1280
    height: 800
    minimumWidth: 1060
    minimumHeight: 680
    title: "简库镜传"
    color: Theme.windowBg

    property string mode: "record"
    property string section: "background"
    // Which kind of thing is being captured. Window and region sources share the
    // whole pipeline with displays; only the filter and crop differ.
    property string sourceKind: "display"
    property rect region: Qt.rect(0, 0, 0, 0)
    property bool regionSet: false
    property bool openPresentationWhenReady: false
    readonly property bool savingRecording: capture.recordingStatus.indexOf("正在保存") === 0
    readonly property var windowLabels: {
        const list = []
        const windows = capture.windowSources
        for (let i = 0; i < windows.length; ++i)
            list.push(windows[i].label)
        return list
    }
    readonly property var outputOptions: {
        const list = ["虚拟窗口（可共享）"]
        const displays = screens.displays
        for (let i = 0; i < displays.length; ++i)
            list.push("输出到 " + displays[i].name + " · " + displays[i].width + "×" + displays[i].height)
        return list
    }
    // True when the currently selected kind has everything it needs to record.
    readonly property bool sourceReady: root.sourceKind === "display"
        ? displayChoice.count > 0 && displayChoice.currentIndex >= 0
        : root.sourceKind === "window"
        ? windowChoice.count > 0 && windowChoice.currentIndex >= 0
        : root.regionSet

    // Starts the selected source and begins recording once it is running.
    function startRecording() {
        if (root.sourceKind === "window") {
            const windows = capture.windowSources
            const index = windowChoice.currentIndex
            if (index < 0 || index >= windows.length)
                return
            capture.startRecordingWindow(windows[index].windowId, settings.current)
        } else if (root.sourceKind === "region") {
            capture.startRecordingRegion(root.region.x, root.region.y,
                root.region.width, root.region.height, settings.current)
        } else {
            capture.startRecordingDisplay(displayChoice.currentIndex, settings.current)
        }
    }

    function startPreview() {
        if (root.sourceKind === "window") {
            const windows = capture.windowSources
            const index = windowChoice.currentIndex
            if (index < 0 || index >= windows.length)
                return
            capture.startWindow(windows[index].windowId)
        } else if (root.sourceKind === "region") {
            if (!root.regionSet)
                return
            capture.startRegion(root.region.x, root.region.y,
                root.region.width, root.region.height)
        } else {
            capture.startDisplay(displayChoice.currentIndex)
        }
    }

    function showAudience() {
        // 0 is the unshareable virtual window; every other entry is a real display, and
        // the list is built from `screens.displays` in the same order, so the index maps
        // straight through.
        const index = outputChoice.currentIndex - 1
        if (index >= 0)
            screens.placeWindowOnDisplay(audience, index, true)
        else
            screens.placeWindowOnDisplay(audience, -1, false)
    }

    // Every place the presentation can end has to go through this, not just hide().
    // Hiding a window that was full-screen on a second display left that display black:
    // the window was gone but its Space was not.
    function endAudience() {
        screens.releaseWindow(audience)
    }

    function selectMode(next) {
        if (capture.recording || capture.busy || savingRecording)
            return
        openPresentationWhenReady = false
        root.endAudience()
        if (capture.running)
            capture.stop()
        mode = next
        section = "background"
    }

    OutputWindow { id: audience }

    RegionSelector {
        id: regionSelector
        onPicked: (x, y, w, h) => {
            root.region = Qt.rect(x, y, w, h)
            root.regionSet = true
        }
    }

    // The canvas layout is computed once, in C++, and shared with the export and
    // the screenshot. QML only maps the resulting fractions onto its stage.
    function refreshCanvas() {
        // Points for the pointer overlay, pixels for the layout. They differ on a
        // Retina display, and using the point size for both made every absolute
        // appearance value (corner radius, inset) twice its exported size.
        canvasPreview.update(settings.current, anim.contentWidth, anim.contentHeight,
            anim.sourcePixelWidth, anim.sourcePixelHeight)
    }

    Component.onCompleted: {
        anim.setSettings(settings.current)
        anim.start()
        refreshCanvas()
        timeline.setFrameRate(exporter.frameRate)
    }
    Connections {
        target: settings
        function onCurrentChanged() {
            anim.setSettings(settings.current)
            refreshCanvas()
        }
    }
    Connections {
        target: anim
        function onContentSizeChanged() { root.refreshCanvas() }
    }
    // The preview has to place the smooth pointer inside the rect that is actually
    // being captured. Mapping it through the primary display is right only for a
    // full-primary-display recording; for a window, a region or a second screen it
    // draws the pointer in the wrong place.
    Connections {
        target: capture
        function onSourceGeometryChanged() {
            const g = capture.sourceGeometry
            if (g && g.widthPoints > 0 && g.widthPixels > 0)
                anim.setSourceGeometry(g.x, g.y, g.widthPoints, g.heightPoints,
                    g.widthPixels, g.heightPixels)
        }
    }
    // The playhead snaps to frames, so the controller has to know the frame rate the
    // export will use. Read from the exporter rather than from a setting, because the
    // exporter is what actually writes the frames.
    Connections {
        target: exporter
        function onFrameRateChanged() { timeline.setFrameRate(exporter.frameRate) }
    }
    Connections {
        target: capture
        function onScreenAuthorizedChanged() {
            if (capture.screenAuthorized)
                permissionGuide.opened = false
        }
        function onCaptureAccessDenied() {
            permissionGuide.opened = true
        }
        function onPermissionIssueChanged() {
            if (capture.permissionIssue.length > 0)
                permissionGuide.opened = true
        }
    }
    onActiveChanged: {
        if (active)
            capture.refreshScreenAuthorization()
    }

    Window {
        id: recordingHud
        visible: false
        width: 392
        height: 64
        x: root.x + (root.width - width) / 2
        y: root.y + 35
        flags: Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
        transientParent: null
        color: "transparent"
        property int elapsedSeconds: 0

        Timer {
            interval: 1000
            repeat: true
            // The on-screen clock freezes while paused, like the recorded file.
            running: recordingHud.visible && !capture.recordingPaused
            onTriggered: recordingHud.elapsedSeconds++
        }
        Rectangle {
            anchors.fill: parent
            radius: 13
            color: "#343437"
            border.width: 1
            border.color: "#59595d"
            MouseArea { anchors.fill: parent; onPressed: recordingHud.startSystemMove() }
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 19
                anchors.rightMargin: 11
                spacing: 12
                Rectangle {
                    width: 9
                    height: 9
                    radius: 5
                    color: capture.recordingPaused ? Theme.textDim : Theme.record
                }
                Text {
                    text: (capture.recordingPaused ? "已暂停  " : "录制中  ")
                          + Math.floor(recordingHud.elapsedSeconds / 60).toString().padStart(2, "0")
                          + ":" + (recordingHud.elapsedSeconds % 60).toString().padStart(2, "0")
                    color: "#f0f0f1"
                    font.pixelSize: 14
                    font.weight: Font.Medium
                }
                Item { Layout.fillWidth: true }
                UiButton {
                    implicitWidth: 84
                    text: capture.recordingPaused ? "继续" : "暂停"
                    tone: "quiet"
                    onClicked: capture.recordingPaused ? capture.resumeRecording() : capture.pauseRecording()
                }
                UiButton { text: "结束"; tone: "quiet"; implicitWidth: 72; onClicked: capture.stop() }
            }
        }
    }

    Connections {
        target: exporter
        function onFinished(ok) {
            if (ok) exporter.revealOutput()
        }
    }

    Connections {
        target: capture
        function onRunningChanged() {
            if (capture.running && root.openPresentationWhenReady) {
                root.openPresentationWhenReady = false
                root.showAudience()
            }
        }
        function onRecordingChanged() {
            if (capture.recording) {
                recordingHud.elapsedSeconds = 0
                recordingHud.show()
                root.hide()
            } else if (recordingHud.visible) {
                recordingHud.hide()
                root.show()
                root.raise()
                root.requestActivate()
            }
        }
        function onStatusChanged() {
            if (capture.status.indexOf("权限") >= 0 || capture.status.indexOf("拒绝") >= 0)
                permissionGuide.opened = true
        }
    }

    Item {
        anchors.fill: parent

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 56
            color: Theme.railBg

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 16
                anchors.rightMargin: 14
                spacing: 12

                Image {
                    source: brand.markMedium
                    sourceSize.width: 20
                    sourceSize.height: 20
                    fillMode: Image.PreserveAspectFit
                    smooth: true
                    // The mark ships at 22/48/128 px; asking for exactly 20 shows the
                    // 22 px file scaled down, which stays sharp on Retina.
                }
                Text {
                    text: brand.displayName
                    color: Theme.text
                    font.pixelSize: 15
                    font.weight: Font.DemiBold
                }
                UiSegmented {
                    Layout.preferredWidth: 148
                    options: ["录制", "演示"]
                    currentIndex: root.mode === "record" ? 0 : 1
                    onActivated: i => root.selectMode(i === 0 ? "record" : "present")
                }

                Item { Layout.fillWidth: true }

                Text { text: "来源"; color: Theme.textDim; font.pixelSize: 11 }
                UiSegmented {
                    id: sourceKindChoice
                    Layout.preferredWidth: 132
                    options: ["屏幕", "窗口", "区域"]
                    currentIndex: root.sourceKind === "window" ? 1 : root.sourceKind === "region" ? 2 : 0
                    enabled: !capture.running && !capture.busy
                    onActivated: i => {
                        root.sourceKind = i === 1 ? "window" : i === 2 ? "region" : "display"
                        // A stale region would silently record the wrong rectangle.
                        if (root.sourceKind !== "region") root.regionSet = false
                    }
                }
                UiComboBox {
                    id: displayChoice
                    visible: root.sourceKind === "display"
                    // Wide enough for "显示器 1 · 3360 × 2100 · 60 Hz": the refresh
                    // rate is part of what the source is, and truncating it defeats
                    // the point of showing it.
                    Layout.preferredWidth: 268
                    model: capture.displayNames
                    enabled: !capture.running && !capture.busy
                }
                UiComboBox {
                    id: windowChoice
                    visible: root.sourceKind === "window"
                    Layout.preferredWidth: 210
                    model: root.windowLabels
                    enabled: !capture.running && !capture.busy && count > 0
                }
                UiButton {
                    visible: root.sourceKind === "region"
                    implicitWidth: 132
                    text: root.regionSet
                        ? Math.round(root.region.width) + " × " + Math.round(root.region.height)
                        : "选择区域…"
                    tone: root.regionSet ? "quiet" : "primary"
                    enabled: !capture.running && !capture.busy
                    onClicked: regionSelector.begin()
                }
                UiButton {
                    implicitWidth: 58
                    text: "刷新"
                    tone: "ghost"
                    enabled: !capture.running && !capture.busy
                    onClicked: capture.refreshDisplays()
                }

                Text {
                    visible: root.mode === "present"
                    text: "输出"
                    color: Theme.textDim
                    font.pixelSize: 11
                }
                UiComboBox {
                    id: outputChoice
                    visible: root.mode === "present"
                    Layout.preferredWidth: 210
                    model: root.outputOptions
                    enabled: !capture.running
                }

                Rectangle { width: 1; height: 22; color: Theme.stroke }

                Text {
                    readonly property bool ready: !capture.running && !capture.recording
                        && capture.screenAuthorized && capture.displayNames.length > 0
                    text: capture.recording ? "\u25CF 录制中"
                        : capture.running ? "\u25CF 画面采集中"
                        : ready ? "\u25CF 就绪" : "\u25CF 未就绪"
                    color: capture.recording ? Theme.record
                        : capture.running ? Theme.accent
                        : ready ? Theme.ok : Theme.textFaint
                    font.pixelSize: 11
                }
                UiButton {
                    implicitWidth: 62
                    text: "权限"
                    tone: capture.screenAuthorized ? "ghost" : "primary"
                    onClicked: permissionGuide.opened = true
                }
                UiButton {
                    implicitWidth: 62
                    text: "截图"
                    tone: "quiet"
                    onClicked: screenshot.capture(settings.current)
                }
                UiButton {
                    // Opens the editor, which is where editing and exporting both
                    // live now. The export used to start from here, which meant the
                    // only way to change an edit before exporting was to make it in a
                    // strip wedged under the preview of a window that is itself being
                    // recorded. Editing wants the whole screen; recording wants a small
                    // window out of the way. They are separate windows.
                    implicitWidth: 92
                    text: "打开编辑器"
                    tone: "quiet"
                    enabled: capture.lastProjectPath.length > 0
                    onClicked: registry.openProject(capture.lastProjectPath, false)
                }
                UiButton {
                    visible: root.mode === "present"
                    implicitWidth: 92
                    text: "观众窗口"
                    tone: "quiet"
                    enabled: capture.running
                    onClicked: root.showAudience()
                }
                UiButton {
                    implicitWidth: 112
                    implicitHeight: 36
                    text: root.mode === "record"
                        ? (capture.recording ? "结束录制" : root.savingRecording ? "正在保存…" : "开始录制")
                        : (capture.running ? "结束演示" : "开始演示")
                    tone: (capture.recording || (root.mode === "present" && capture.running)) ? "danger"
                        : root.mode === "record" ? "record" : "primary"
                    enabled: root.mode === "record"
                        ? (capture.recording || (!capture.busy && !root.savingRecording && root.sourceReady))
                        : (!capture.busy && (capture.running || root.sourceReady))
                    onClicked: {
                        if (root.mode === "record") {
                            if (capture.recording) capture.stop()
                            else root.startRecording()
                        } else if (capture.running) {
                            root.endAudience()
                            capture.stop()
                        } else {
                            root.openPresentationWhenReady = true
                            root.startPreview()
                        }
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            IconRail {
                Layout.preferredWidth: Theme.railWidth
                Layout.fillHeight: true
                current: root.section
                onSelected: s => root.section = s
            }

            SettingsPage {
                Layout.preferredWidth: Theme.panelWidth
                Layout.fillHeight: true
                section: root.section
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.windowBg

                PreviewCanvas {
                    anchors.fill: parent
                    anchors.bottomMargin: editStrip.visible ? editStrip.height : 0
                    live: capture.running
                }

                Text {
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    anchors.margins: 16
                    text: capture.running
                        ? (root.mode === "record" ? "实时预览 · 录制画面" : "实时预览 · 演示输出")
                        : "未开始采集 · 显示的是画布外观预览"
                    color: Theme.textFaint
                    font.pixelSize: 11
                }

                // The edit strip sits under the preview, where the thing it edits is.
                // Hidden until a recording exists: an empty ruler would be a control
                // that does nothing.
                TimelineStrip {
                    id: editStrip
                    // The strip belongs to the editor now; the main window keeps a
                    // read-only one for whatever recording is loaded.
                    // The main window keeps a read-only strip: the editable one lives
                    // in the editor, where there is room for it and where the export
                    // that consumes the edit also lives.
                    interactive: false
                    controller: timeline
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    visible: ready && !capture.running
                    height: 74
                }

                Text {
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.margins: 16
                    text: {
                        if (exporter.error.length > 0)
                            return "导出失败：" + exporter.error
                        if (exporter.status.length > 0)
                            return exporter.status
                        return capture.recordingStatus.length > 0 ? capture.recordingStatus : capture.status
                    }
                    color: exporter.error.length > 0 ? Theme.danger : Theme.textFaint
                    font.pixelSize: 11
                    elide: Text.ElideMiddle
                    width: Math.min(implicitWidth, parent.width - 40)
                    horizontalAlignment: Text.AlignRight
                }

                // Export progress: a thin bar along the bottom edge of the preview.
                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 2
                    visible: exporter.busy
                    color: Theme.stroke
                    Rectangle {
                        height: parent.height
                        width: parent.width * Math.max(0, Math.min(1, exporter.progress))
                        color: Theme.accent
                    }
                }
            }
        }
    }

    PermissionGuide {
        id: permissionGuide
        anchors.fill: parent
    }
    }
}
