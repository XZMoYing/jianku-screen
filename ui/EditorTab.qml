import QtQuick
import QtQuick.Layouts
import Jianku.Screen

// The editable content of one tab: the recording preview on top, the edit timeline
// under it, and the appearance settings to the side.
//
// The split of responsibilities is the point of this file. Everything here is a *view*
// of the session handed to it by the window; the session owns the timeline, its undo
// stack, the playhead and the exporter. That is why a tab can be dragged to another
// window without losing anything — the view is rebuilt, the session is not.
Item {
    id: tab
    // The session this tab shows, set by EditorWindow when it creates the tab.
    //
    // It cannot be reached through the window's id: a component in its own file has no
    // access to the ids of the file that instantiates it, so `editor.session` here is
    // `undefined` — which silently produced a strip bound to nothing and a wall of
    // "Cannot read property of undefined" instead of a visible failure.
    property var session: null
    readonly property var controller: session ? session.timeline : null
    readonly property var exporter: session ? session.exporter : null
    readonly property var crop: session ? session.crop : null
    readonly property bool cropActive: !!crop && crop.active
    property string section: "background"
    property real timelineHeight: 320
    property bool exportDetailsExpanded: false
    readonly property bool focusSelected: !!controller && controller.selectedFocusId.length > 0
    readonly property bool showExportDetails: !cropActive && (!focusSelected || exportDetailsExpanded)
    Shortcut { sequence: "Space"; context: Qt.WindowShortcut; enabled: !tab.cropActive && (!tab.Window.window || !tab.Window.window.activeFocusItem || tab.Window.window.activeFocusItem.cursorPosition === undefined); onActivated: player.toggle() }
    Shortcut { sequence: "Escape"; context: Qt.WindowShortcut; enabled: tab.cropActive; onActivated: tab.crop.cancel() }
    Component.onDestruction: { if (tab.cropActive) tab.crop.cancel() }
    Connections {
        target: tab.exporter
        function onFrameRateChanged() { if (tab.controller) tab.controller.setFrameRate(tab.exporter.frameRate) }
        function onFinished(ok) { if (ok) tab.exporter.revealOutput() }
    }

    Connections {
        target: tab.controller
        function onSelectionChanged() { if (tab.controller.selectedFocusId.length > 0) player.pause() }
    }
    RowLayout {
        anchors.fill: parent
        anchors.bottomMargin: tab.timelineHeight
        spacing: 0

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            RecordingPlayer {
                id: player
                anchors.fill: parent
                anchors.margins: 20
                controller: tab.controller
                cropEditing: tab.cropActive
                options: tab.session ? tab.session.settings.current : ({})
            }
            MouseArea {
                objectName: "focusCanvasPicker"
                anchors.fill: player; enabled: !tab.cropActive && !!tab.controller && tab.controller.selectedFocusId.length > 0 && player.focusPreview && !player.playing && !player.loading
                cursorShape: Qt.CrossCursor
                function place(x, y) {
                    const source = player.sourcePointAt(x, y)
                    if (source.valid) tab.controller.updateFocus(tab.controller.selectedFocusId, {fixedPosition: true, focusX: source.x, focusY: source.y})
                }
                onPressed: mouse => place(mouse.x, mouse.y)
                onPositionChanged: mouse => { if (pressed) place(mouse.x, mouse.y) }
            }
            Rectangle {
                visible: !tab.cropActive && player.focusPreview && !player.playing && !!tab.controller && tab.controller.selectedFocusId.length > 0
                x: player.x + player.focusMarker.x - 8; y: player.y + player.focusMarker.y - 8; width: 16; height: 16; radius: 8; color: "transparent"; border.width: 2; border.color: "#d4b8ff"
            }
            Row {
                anchors { top: parent.top; horizontalCenter: parent.horizontalCenter; topMargin: 8 }
                spacing: 6; visible: !tab.cropActive && !!tab.controller && tab.controller.selectedFocusId.length > 0
                UiButton { objectName: "focusPreviewButton"; text: player.focusPreview ? "目标构图预览" : "动画预览"; selected: player.focusPreview; onClicked: { player.pause(); player.focusPreview = !player.focusPreview } }
                UiButton { text: "取消选择"; onClicked: tab.controller.clearSelection() }
            }
            CropCanvas {
                anchors.fill: player; visible: tab.cropActive
                controller: tab.crop; player: player
            }
            UiButton {
                objectName: "beginCropButton"
                anchors { left: parent.left; top: parent.top; leftMargin: 20; topMargin: 8 }
                text: "裁切画面"; visible: !tab.cropActive
                enabled: !!tab.crop && player.hasFrame && !player.loading && !tab.exporter.busy
                onClicked: { player.pause(); tab.controller.clearSelection(); tab.crop.begin() }
            }
            Text {
                anchors.centerIn: player
                visible: player.loading || !player.hasFrame || player.error.length > 0
                text: player.error.length > 0 ? player.error
                    : player.loading ? "正在准备视频与动画预览…" : "正在载入录制画面…"
                color: player.error.length > 0 ? Theme.danger : Theme.textDim
                wrapMode: Text.Wrap
                width: Math.min(440, player.width - 40)
                horizontalAlignment: Text.AlignHCenter
            }
        }

        // --- right-hand settings and export -----------------------------------
        Rectangle {
            Layout.preferredWidth: tab.width < 1150 ? 320 : 370
            Layout.fillHeight: true
            color: Theme.panelBg
            border.width: 1
            border.color: Theme.strokeSoft

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 10

                Text {
                    Layout.fillWidth: true
                    text: tab.session ? tab.session.title : ""
                    color: Theme.text
                    font.pixelSize: 14
                    font.weight: Font.DemiBold
                    elide: Text.ElideMiddle
                }
                Text {
                    Layout.fillWidth: true
                    text: tab.session ? tab.session.projectDirectory : ""
                    color: Theme.textFaint
                    font.pixelSize: 10
                    elide: Text.ElideMiddle
                }
                Text {
                    Layout.fillWidth: true
                    visible: tab.session && tab.session.error.length > 0
                    text: tab.session ? tab.session.error : ""
                    color: Theme.danger
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                }

                RowLayout {
                    Layout.fillWidth: true
                    UiButton { Layout.fillWidth: true; text: "在访达中打开工程"; onClicked: if (tab.session) tab.session.revealProject() }
                    UiButton { text: "保存工程"; enabled: !tab.cropActive && !!tab.session && tab.session.dirty; onClicked: tab.session.save() }
                }
                UiSegmented {
                    Layout.fillWidth: true
                    visible: !tab.cropActive && (!tab.controller || tab.controller.selectedFocusId.length === 0)
                    options: ["背景", "光标", "缩放", "音频"]
                    currentIndex: Math.max(0, ["background", "cursor", "motion", "audio"].indexOf(tab.section))
                    onActivated: i => tab.section = ["background", "cursor", "motion", "audio"][i]
                }
                FocusInspector {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    visible: !tab.cropActive && !!tab.controller && tab.controller.selectedFocusId.length > 0
                    controller: tab.controller
                    onPreviewRequested: { player.pause(); player.focusPreview = true }
                }
                SettingsPage {
                    visible: !tab.cropActive && (!tab.controller || tab.controller.selectedFocusId.length === 0)
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    section: tab.section
                    store: tab.session ? tab.session.settings : settings
                    editingRecording: true
                }
                CropInspector {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    visible: tab.cropActive
                    controller: tab.crop
                }
                Text {
                    Layout.fillWidth: true
                    text: "编辑自动保存 · 预览 540p，导出使用所选分辨率"
                    visible: !tab.cropActive
                    color: Theme.textFaint; font.pixelSize: 10
                }

                // Export lives here, at the bottom of the settings column, the way
                // Screen Studio puts it: the whole point of opening the editor is to
                // produce the file, so the action that does it should not be somewhere
                // the user has to go looking.
                UiButton {
                    Layout.fillWidth: true
                    implicitHeight: 26
                    visible: !tab.cropActive
                    text: tab.focusSelected ? (tab.showExportDetails ? "收起导出设置" : "展开导出设置") : "导出设置"
                    enabled: tab.focusSelected
                    onClicked: tab.exportDetailsExpanded = !tab.exportDetailsExpanded
                }
                UiSegmented {
                    Layout.fillWidth: true
                    visible: tab.showExportDetails
                    options: ["原始", "4K", "1440p", "1080p", "720p"]
                    currentIndex: {
                        const heights = [0, 2160, 1440, 1080, 720]
                        const i = heights.indexOf(Number(tab.exporter ? tab.exporter.exportHeight : 0))
                        return i >= 0 ? i : 0
                    }
                    onActivated: (i) => {
                        if (tab.exporter)
                            tab.exporter.exportHeight = [0, 2160, 1440, 1080, 720][i]
                    }
                }
                UiSegmented {
                    Layout.fillWidth: true
                    visible: tab.showExportDetails
                    options: ["24", "30", "60", "120"]
                    currentIndex: {
                        const rates = [24, 30, 60, 120]
                        const i = rates.indexOf(Number(tab.exporter ? tab.exporter.frameRate : 60))
                        return i >= 0 ? i : 2
                    }
                    onActivated: (i) => {
                        if (tab.exporter)
                            tab.exporter.frameRate = [24, 30, 60, 120][i]
                    }
                }
                Text {
                    Layout.fillWidth: true
                    visible: !tab.cropActive
                    text: tab.exporter && tab.exporter.outputSizeLabel.length > 0
                        ? "成片 " + tab.exporter.outputSizeLabel + " · " + tab.exporter.frameRate + " fps"
                        : "—"
                    color: Theme.textFaint
                    font.pixelSize: 10
                }
                UiButton {
                    Layout.fillWidth: true
                    implicitHeight: 34
                    text: tab.exporter && tab.exporter.busy ? "取消导出" : "导出成片"
                    tone: "primary"
                    enabled: !tab.cropActive && !!tab.exporter && (tab.exporter.busy || tab.exporter.defaultOutputPath.length > 0)
                    visible: !tab.cropActive
                    onClicked: {
                        if (!tab.exporter)
                            return
                        if (tab.exporter.busy)
                            tab.exporter.cancel()
                        else
                            { if (tab.session.save()) tab.exporter.start(tab.exporter.defaultOutputPath, true, true, true, true) }
                    }
                }
                // A drawn bar rather than QtQuick.Controls' ProgressBar: the rest of
                // this UI is drawn from the same few primitives, and pulling in the
                // Controls style for one progress bar would give it a different
                // palette from everything around it.
                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: 4
                    radius: 2
                    color: Theme.fieldBg
                    visible: !!tab.exporter && tab.exporter.busy
                    Rectangle {
                        width: parent.width * Math.max(0, Math.min(1, tab.exporter ? tab.exporter.progress : 0))
                        height: parent.height
                        radius: 2
                        color: Theme.accent
                    }
                }
                Text {
                    Layout.fillWidth: true
                    visible: !tab.cropActive && !!tab.exporter && tab.exporter.status.length > 0
                    text: tab.exporter ? tab.exporter.status : ""
                    color: tab.exporter && tab.exporter.error.length > 0 ? Theme.danger : Theme.textFaint
                    font.pixelSize: 10
                    wrapMode: Text.WordWrap
                }
            }
        }
    }
    TimelineStrip {
        id: timelineStrip
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
        height: tab.timelineHeight
        controller: tab.controller
        enabled: !tab.cropActive
        media: tab.session ? tab.session.media : null
        playing: player.playing
        canPlay: player.hasFrame && !player.loading
        frameRate: tab.exporter ? tab.exporter.frameRate : 60
        onPlaybackRequested: player.toggle()
    }
    MouseArea {
        anchors { left: timelineStrip.left; right: timelineStrip.right; top: timelineStrip.top; topMargin: -5 }
        height: 10; cursorShape: Qt.SplitVCursor
        property real initial: 320
        property real pressY: 0
        onPressed: mouse => { initial = tab.timelineHeight; pressY = mapToItem(tab, mouse.x, mouse.y).y }
        onPositionChanged: mouse => { if (pressed) tab.timelineHeight = Math.max(180, Math.min(tab.height * 0.55, initial + pressY - mapToItem(tab, mouse.x, mouse.y).y)) }
        onDoubleClicked: tab.timelineHeight = 320
    }

}
