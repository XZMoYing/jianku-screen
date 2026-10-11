import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

FocusScope {
    id: root
    objectName: "editorTimeline"
    implicitHeight: interactive ? 270 : 86
    property var controller: null
    property var media: null
    property bool interactive: true
    property bool playing: false
    property bool canPlay: false
    property real frameRate: 60
    property bool showThumbnails: true
    property bool showAudio: true
    property bool showFocus: true
    property bool snapping: true
    property real timelineZoom: 1
    property int contextIndex: -1
    property int insertionIndex: -1
    property bool movingClips: false
    property bool gestureCancelled: false
    property string trimId: ""
    property real trimStart: 0
    property real trimEnd: 0
    readonly property bool ready: !!controller && controller.loaded
    readonly property real duration: ready ? controller.outputDurationMs : 1
    readonly property real labelWidth: interactive ? 82 : 0
    readonly property real pixelsPerMs: Math.max(1, viewport.width - 24) * timelineZoom / Math.max(1, duration)
    readonly property bool systemLane: interactive && showAudio && !!media && media.hasSystemAudio
    readonly property bool microphoneLane: interactive && showAudio && !!media && media.hasMicrophone
    readonly property real screenHeight: interactive ? 76 : 22
    readonly property real focusHeight: interactive && showFocus ? 76 : 0
    readonly property real trackHeight: 28 + screenHeight + focusHeight + (systemLane ? 40 : 0) + (microphoneLane ? 40 : 0) + 8
    signal playbackRequested()

    function rawTime(viewX) { return (viewport.contentX + viewX - 12) / pixelsPerMs }
    function step(frames) { if (ready) controller.setPlayheadMs(controller.snappedPlayheadMs() + frames * 1000 / frameRate) }
    function scrub(viewX, bypass) {
        if (ready) controller.setPlayheadMs(controller.snapTime(rawTime(viewX), pixelsPerMs, !snapping || bypass))
    }
    function zoomTo(factor, anchorX) {
        const time = rawTime(anchorX)
        timelineZoom = Math.max(1, Math.min(128, factor))
        viewport.contentX = Math.max(0, Math.min(viewport.contentWidth - viewport.width, 12 + time * pixelsPerMs - anchorX))
    }
    function closestInsertion(viewX) {
        const time = rawTime(viewX), segments = controller.segments
        let index = 0, best = Number.POSITIVE_INFINITY
        for (let i = 0; i <= segments.length; ++i) {
            const point = i === segments.length ? duration : segments[i].outputStartMs
            if (Math.abs(time - point) < best) { best = Math.abs(time - point); index = i }
        }
        return index
    }
    function insertionTime() {
        const segments = controller ? controller.segments : []
        return insertionIndex >= 0 && insertionIndex < segments.length ? segments[insertionIndex].outputStartMs : duration
    }
    Keys.onPressed: event => {
        if (!interactive || !ready || (event.modifiers & (Qt.ControlModifier | Qt.MetaModifier))) {
            if (!interactive || !ready) return
            if (event.key === Qt.Key_C && controller.selectedFocusId.length > 0) { controller.copyFocus(); event.accepted = true }
            else if (event.key === Qt.Key_V) { controller.pasteFocus(-1, !!(event.modifiers & Qt.ShiftModifier)); event.accepted = true }
            return
        }
        if (event.key === Qt.Key_S) controller.splitAtPlayhead()
        else if (event.key === Qt.Key_Delete || event.key === Qt.Key_Backspace || event.key === Qt.Key_D) controller.deleteSelection()
        else if (event.key === Qt.Key_Q) controller.rippleAtPlayhead(true)
        else if (event.key === Qt.Key_W) controller.rippleAtPlayhead(false)
        else if (event.key === Qt.Key_Left) step(event.modifiers & Qt.ShiftModifier ? -5 : -1)
        else if (event.key === Qt.Key_Right) step(event.modifiers & Qt.ShiftModifier ? 5 : 1)
        else if (event.key === Qt.Key_Escape) { gestureCancelled = true; movingClips = false; insertionIndex = -1; trimId = ""; controller.endSnap(); controller.clearSelection() }
        else return
        event.accepted = true
    }
    Connections {
        target: root.controller
        function onPlayheadChanged() {
            if (!root.playing || viewport.moving) return
            const x = 12 + root.controller.playheadMs * root.pixelsPerMs
            if (x > viewport.contentX + viewport.width - 24 || x < viewport.contentX + 12)
                viewport.contentX = Math.max(0, Math.min(viewport.contentWidth - viewport.width, x - viewport.width * 0.25))
        }
    }
    Rectangle { anchors.fill: parent; color: Theme.panelBg; border.color: Theme.strokeSoft }
    RowLayout {
        id: tools
        anchors { top: parent.top; left: parent.left; right: parent.right; margins: 9 }
        height: root.interactive ? 34 : 18
        spacing: 6
        UiButton { text: "切分"; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; enabled: root.ready; onClicked: root.controller.splitAtPlayhead(); ToolTip.visible: hovered; ToolTip.text: "在播放头处分割（S）" }
        UiButton { text: "删除"; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; enabled: root.ready && (root.controller.selectedCount > 0 || root.controller.selectedFocusId.length > 0); onClicked: root.controller.deleteSelection(); ToolTip.visible: hovered; ToolTip.text: "删除选中片段（Delete）" }
        UiButton { text: "撤销"; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; enabled: root.ready && root.controller.canUndo; onClicked: root.controller.undo() }
        UiButton { text: "重做"; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; enabled: root.ready && root.controller.canRedo; onClicked: root.controller.redo() }
        UiButton { text: "恢复剪辑"; implicitHeight: 28; implicitWidth: 82; visible: root.interactive && root.width > 1120; enabled: root.ready && (root.controller.edited || root.controller.segments.length > 1); onClicked: root.controller.reset() }
        UiButton { objectName: "addFocusButton"; text: "添加焦点"; implicitHeight: 28; implicitWidth: 76; visible: root.interactive; enabled: root.ready; onClicked: root.controller.addFocusAtPlayhead() }
        Item { Layout.fillWidth: true }
        UiButton { text: "‹"; implicitWidth: 34; implicitHeight: 30; visible: root.interactive; enabled: root.ready; onClicked: root.step(-1); ToolTip.visible: hovered; ToolTip.text: "上一帧（←）" }
        UiButton { text: root.playing ? "暂停" : "播放"; implicitWidth: 60; implicitHeight: 30; visible: root.interactive; enabled: root.canPlay; onClicked: root.playbackRequested() }
        UiButton { text: "›"; implicitWidth: 34; implicitHeight: 30; visible: root.interactive; enabled: root.ready; onClicked: root.step(1); ToolTip.visible: hovered; ToolTip.text: "下一帧（→）" }
        Text { text: root.ready ? root.controller.playheadLabel + " / " + (root.duration / 1000).toFixed(2) + "s" : "时间线"; color: Theme.textDim; font.pixelSize: 11; font.family: "Menlo"; Layout.preferredWidth: root.interactive ? 130 : 100 }
        Item { Layout.fillWidth: true }
        UiButton { text: "轨道"; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; onClicked: trackMenu.popup() }
        UiButton { text: "吸附"; selected: root.snapping; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; onClicked: root.snapping = !root.snapping; ToolTip.visible: hovered; ToolTip.text: "对齐边界与播放头；Shift 暂时关闭" }
        UiButton { text: "适配"; implicitHeight: 28; implicitWidth: 52; visible: root.interactive; onClicked: { root.timelineZoom = 1; viewport.contentX = 0 } }
        Slider {
            visible: root.interactive; Layout.preferredWidth: root.width > 1200 ? 110 : 76
            from: 0; to: 1; value: Math.log(root.timelineZoom) / Math.log(128)
            onMoved: root.zoomTo(Math.pow(128, value), viewport.width / 2)
            ToolTip.visible: hovered; ToolTip.text: "时间线 " + root.timelineZoom.toFixed(1) + "×"
        }
    }
    Menu {
        id: trackMenu
        MenuItem { text: "视频缩略图"; checkable: true; checked: root.showThumbnails; onTriggered: root.showThumbnails = checked }
        MenuItem { text: "焦点轨道"; checkable: true; checked: root.showFocus; onTriggered: root.showFocus = checked }
        MenuItem { text: "重建自动焦点"; enabled: root.ready; onTriggered: root.controller.regenerateFocus() }
        MenuItem { text: "音频波形"; checkable: true; checked: root.showAudio; onTriggered: root.showAudio = checked }
    }
    Menu {
        id: clipMenu
        MenuItem { text: "在播放头处分割"; onTriggered: root.controller.splitAtPlayhead() }
        Menu {
            title: "片段速度"
            Repeater {
                model: [0.5, 1, 1.5, 2, 4, 8, 12, 20, 50, 100]
                delegate: MenuItem { required property var modelData; text: modelData + "×"; onTriggered: root.controller.setSelectedSpeed(modelData) }
            }
        }
        MenuSeparator {}
        MenuItem { text: "删除选中片段"; onTriggered: root.controller.deleteSelection() }
        MenuItem { text: "裁掉播放头前段（Q）"; onTriggered: root.controller.rippleAtPlayhead(true) }
        MenuItem { text: "裁掉播放头后段（W）"; onTriggered: root.controller.rippleAtPlayhead(false) }
        MenuSeparator {}
        MenuItem { text: "合并后一片段"; enabled: root.ready && root.contextIndex + 1 < root.controller.segments.length; onTriggered: root.controller.mergeClip(root.contextIndex, false) }
        MenuItem { text: "还原与后一片段之间的剪切"; enabled: root.ready && root.contextIndex + 1 < root.controller.segments.length; onTriggered: root.controller.mergeClip(root.contextIndex, true) }
    }
    Item {
        id: lanes
        anchors { top: tools.bottom; bottom: overview.top; left: parent.left; right: parent.right; topMargin: 6; bottomMargin: 6 }
        clip: true
        Rectangle {
            width: root.labelWidth; height: parent.height; color: Theme.railBg
            Column {
                y: 28 - viewport.contentY; width: parent.width; spacing: 0
                Text { width: parent.width; height: root.screenHeight; text: "屏幕"; color: Theme.textDim; font.pixelSize: 11; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                Text { width: parent.width; height: root.focusHeight / 2; visible: root.focusHeight > 0; text: "自动焦点"; color: "#d5b477"; font.pixelSize: 10; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                Text { width: parent.width; height: root.focusHeight / 2; visible: root.focusHeight > 0; text: "手动焦点"; color: "#bea0ef"; font.pixelSize: 10; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                Text { width: parent.width; height: root.systemLane ? 40 : 0; visible: root.systemLane; text: "系统声音"; color: "#8bc6ae"; font.pixelSize: 10; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                Text { width: parent.width; height: root.microphoneLane ? 40 : 0; visible: root.microphoneLane; text: "麦克风"; color: "#8bc3d5"; font.pixelSize: 10; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
            }
        }
        Flickable {
            id: viewport
            objectName: "timelineViewport"
            anchors { left: parent.left; leftMargin: root.labelWidth; right: parent.right; top: parent.top; bottom: parent.bottom; rightMargin: 10 }
            contentWidth: Math.max(width, (width - 24) * root.timelineZoom + 24)
            contentHeight: Math.max(height, root.trackHeight)
            clip: true; boundsBehavior: Flickable.StopAtBounds
            interactive: root.interactive
            ScrollBar.horizontal: ScrollBar { policy: ScrollBar.AsNeeded }
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
            WheelHandler {
                enabled: root.interactive
                acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                onWheel: event => {
                    const dx = event.pixelDelta.x || event.angleDelta.x / 3
                    const dy = event.pixelDelta.y || event.angleDelta.y / 3
                    if (Math.abs(dx) > Math.abs(dy) || event.modifiers & Qt.ShiftModifier)
                        viewport.contentX = Math.max(0, Math.min(viewport.contentWidth - viewport.width, viewport.contentX - (Math.abs(dx) > Math.abs(dy) ? dx : dy)))
                    else root.zoomTo(root.timelineZoom * Math.exp(dy / 180), event.x)
                    event.accepted = true
                }
            }
            PinchHandler {
                enabled: root.interactive; target: null
                property real initialZoom: 1
                onActiveChanged: if (active) initialZoom = root.timelineZoom
                onActiveScaleChanged: if (active) root.zoomTo(initialZoom * activeScale, centroid.position.x)
            }
            Repeater {
                model: root.ready ? root.controller.visibleTicks(Math.max(0, root.rawTime(0)), Math.min(root.duration, root.rawTime(viewport.width)), viewport.width) : []
                delegate: Item {
                    required property var modelData
                    x: 12 + modelData.timeMs * root.pixelsPerMs; height: viewport.contentHeight; width: 1
                    Rectangle { y: 19; width: 1; height: parent.height - 19; color: Theme.strokeSoft; opacity: 0.55 }
                    Text { x: 4; y: 0; text: modelData.label; font.pixelSize: 9; color: Theme.textFaint }
                }
            }
            MouseArea {
                width: viewport.contentWidth; height: 28; enabled: root.interactive
                onPressed: mouse => { root.forceActiveFocus(); root.controller.beginSnap(-1, true); root.scrub(mouse.x - viewport.contentX, mouse.modifiers & Qt.ShiftModifier) }
                onPositionChanged: mouse => { if (pressed) root.scrub(mouse.x - viewport.contentX, mouse.modifiers & Qt.ShiftModifier) }
                onReleased: root.controller.endSnap()
                onCanceled: root.controller.endSnap()
            }
            Repeater {
                model: root.ready ? root.controller.segments : []
                delegate: Rectangle {
                    id: segmentClip
                    objectName: "timelineClip-" + modelData.index
                    required property var modelData
                    readonly property bool selected: root.controller.selectedIds.indexOf(modelData.id) >= 0
                    readonly property real visibleLeft: Math.max(0, viewport.contentX - x)
                    readonly property real visibleRight: Math.min(width, viewport.contentX + viewport.width - x)
                    readonly property int firstTile: Math.max(0, Math.floor(visibleLeft / 120))
                    readonly property int tileCount: visibleRight > visibleLeft && root.showThumbnails && root.media ? Math.max(0, Math.ceil(visibleRight / 120) - firstTile) : 0
                    x: 12 + modelData.outputStartMs * root.pixelsPerMs; y: 28
                    width: Math.max(2, (modelData.outputEndMs - modelData.outputStartMs) * root.pixelsPerMs - 2)
                    height: root.screenHeight - 4; radius: 5; clip: true
                    color: selected ? "#293a58" : "#29343e"
                    opacity: root.movingClips && selected ? 0.5 : 1
                    Repeater {
                        model: segmentClip.tileCount
                        delegate: Image {
                            required property int index
                            objectName: "filmstripTile"
                            x: (segmentClip.firstTile + index) * 120; y: 22; width: 120; height: segmentClip.height - 22
                            fillMode: Image.PreserveAspectCrop; asynchronous: true; sourceSize: Qt.size(320, 200)
                            source: root.controller.thumbnailUrl(Math.min(segmentClip.modelData.sourceEndMs - 17, segmentClip.modelData.sourceStartMs + (x + 60) / Math.max(1, segmentClip.width) * (segmentClip.modelData.sourceEndMs - segmentClip.modelData.sourceStartMs)))
                        }
                    }
                    Text { x: 12; y: 5; width: parent.width - 24; text: "录屏 " + (modelData.index + 1) + " · " + Number(modelData.speed).toFixed(2) + "×"; color: Theme.text; font.pixelSize: 10; elide: Text.ElideRight; visible: parent.width > 32 }
                    Rectangle { anchors.fill: parent; color: "transparent"; radius: 5; border.width: segmentClip.selected ? 2 : 1; border.color: segmentClip.selected ? Theme.accent : "#596068" }
                    MouseArea {
                        anchors.fill: parent; acceptedButtons: Qt.LeftButton | Qt.RightButton; enabled: root.interactive
                        cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                        property real pressX: 0
                        property bool dragging: false
                        onPressed: mouse => {
                            root.forceActiveFocus(); dragging = false; root.gestureCancelled = false
                            pressX = segmentClip.mapToItem(viewport, mouse.x, mouse.y).x
                            const multi = mouse.modifiers & (Qt.MetaModifier | Qt.ControlModifier), range = mouse.modifiers & Qt.ShiftModifier
                            if (!segmentClip.selected || multi || range) root.controller.selectSegment(segmentClip.modelData.index, !!multi, !!range)
                            if (mouse.button === Qt.RightButton) { root.contextIndex = segmentClip.modelData.index; clipMenu.popup(); return }
                            if (!multi && !range) root.controller.setPlayheadMs(root.rawTime(pressX))
                            if (mouse.modifiers & Qt.AltModifier) root.controller.splitAtPlayhead()
                        }
                        onPositionChanged: mouse => {
                            if (!pressed || pressedButtons & Qt.RightButton) return
                            const x = segmentClip.mapToItem(viewport, mouse.x, mouse.y).x
                            if (Math.abs(x - pressX) > 6) dragging = true
                            if (dragging) { root.movingClips = true; root.insertionIndex = root.closestInsertion(x) }
                        }
                        onReleased: mouse => {
                            const insert = root.insertionIndex, move = dragging
                            root.movingClips = false; root.insertionIndex = -1; dragging = false
                            if (move && !root.gestureCancelled) root.controller.reorderSelection(insert)
                        }
                        onCanceled: { root.movingClips = false; root.insertionIndex = -1 }
                    }
                    Repeater {
                        model: root.interactive ? [true, false] : []
                        delegate: Rectangle {
                            id: edge
                            objectName: (modelData ? "clipHead-" : "clipTail-") + segmentClip.modelData.index
                            required property bool modelData
                            x: modelData ? 0 : segmentClip.width - width; width: 9; height: segmentClip.height; color: "transparent"
                            Rectangle { anchors.centerIn: parent; width: 2; height: 24; radius: 1; color: Theme.text; visible: segmentClip.selected || trimMouse.containsMouse }
                            MouseArea {
                                id: trimMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.SizeHorCursor
                                property real originalStart: 0
                                property real originalEnd: 0
                                property var bounds: ({lower: 0, upper: 0})
                                property bool rateMode: false
                                onPressed: mouse => {
                                    root.forceActiveFocus(); root.gestureCancelled = false; root.controller.selectSegment(segmentClip.modelData.index)
                                    originalStart = segmentClip.modelData.outputStartMs; originalEnd = segmentClip.modelData.outputEndMs
                                    bounds = root.controller.clipSourceBounds(segmentClip.modelData.index)
                                    root.trimStart = originalStart; root.trimEnd = originalEnd; root.trimId = segmentClip.modelData.id
                                    rateMode = !edge.modelData && !!(mouse.modifiers & Qt.ControlModifier)
                                    root.controller.beginSnap(segmentClip.modelData.index)
                                }
                                onPositionChanged: mouse => {
                                    if (!pressed) return
                                    const point = edge.mapToItem(viewport, mouse.x, mouse.y).x
                                    const desired = root.controller.snapTime(root.rawTime(point), root.pixelsPerMs, !root.snapping || !!(mouse.modifiers & Qt.ShiftModifier))
                                    if (edge.modelData) root.trimStart = Math.max(originalStart + (bounds.lower - segmentClip.modelData.sourceStartMs) / segmentClip.modelData.speed, Math.min(originalEnd - 100, desired))
                                    else root.trimEnd = Math.max(originalStart + 100, rateMode ? desired : Math.min(originalStart + (bounds.upper - segmentClip.modelData.sourceStartMs) / segmentClip.modelData.speed, desired))
                                }
                                onReleased: {
                                    const index = segmentClip.modelData.index, start = root.trimStart, end = root.trimEnd, rate = rateMode
                                    root.trimId = ""; root.controller.endSnap()
                                    if (root.gestureCancelled) return
                                    if (rate) root.controller.retimeClip(index, end - start)
                                    else root.controller.trimClip(index, start, end)
                                }
                                onCanceled: { root.trimId = ""; root.controller.endSnap() }
                            }
                        }
                    }
                }
            }
            FocusLane { y: 28 + root.screenHeight; width: viewport.contentWidth; visible: root.focusHeight > 0; controller: root.controller; viewport: viewport; host: root; pixelsPerMs: root.pixelsPerMs; automatic: true; snapping: root.snapping }
            FocusLane { y: 28 + root.screenHeight + 38; width: viewport.contentWidth; visible: root.focusHeight > 0; controller: root.controller; viewport: viewport; host: root; pixelsPerMs: root.pixelsPerMs; automatic: false; snapping: root.snapping }
            Repeater {
                model: root.systemLane && root.microphoneLane ? [0, 1] : root.systemLane ? [0] : root.microphoneLane ? [1] : []
                delegate: Item {
                    id: audioLane
                    required property int index
                    required property int modelData
                    y: 28 + root.screenHeight + root.focusHeight + index * 40; width: viewport.contentWidth; height: 36
                    Repeater {
                        model: root.ready ? root.controller.segments : []
                        delegate: Rectangle {
                            id: audioClip
                            required property var modelData
                            readonly property real visibleOffset: Math.max(0, viewport.contentX - x)
                            readonly property real visibleLimit: Math.min(width, viewport.contentX + viewport.width - x)
                            x: 12 + modelData.outputStartMs * root.pixelsPerMs
                            width: Math.max(1, (modelData.outputEndMs - modelData.outputStartMs) * root.pixelsPerMs - 2); height: parent.height; radius: 4
                            color: audioLane.modelData === 0 ? "#20362e" : "#20343e"; border.color: audioLane.modelData === 0 ? "#345749" : "#34535f"
                            Canvas {
                                id: waveCanvas
                                x: audioClip.visibleOffset; width: Math.max(0, audioClip.visibleLimit - audioClip.visibleOffset); height: audioClip.height
                                property var peaks: {
                                    if (!root.media || root.media.loading || width <= 0) return []
                                    const length = audioClip.modelData.sourceEndMs - audioClip.modelData.sourceStartMs
                                    return root.media.waveform(audioLane.modelData, audioClip.modelData.sourceStartMs + audioClip.visibleOffset / Math.max(1, audioClip.width) * length,
                                        audioClip.modelData.sourceStartMs + audioClip.visibleLimit / Math.max(1, audioClip.width) * length, Math.ceil(width / 3))
                                }
                                onPeaksChanged: requestPaint()
                                onPaint: {
                                    const ctx = getContext("2d"); ctx.clearRect(0, 0, width, height)
                                    ctx.fillStyle = audioLane.modelData === 0 ? "#85bea4" : "#86c0d2"
                                    for (let i = 0; i < peaks.length; ++i) { const h = Math.max(1, peaks[i] * (height - 8)); ctx.fillRect(i * width / peaks.length, (height - h) / 2, 2, h) }
                                }
                            }
                            MouseArea { anchors.fill: parent; enabled: root.interactive; onClicked: mouse => { root.forceActiveFocus(); root.controller.selectSegment(audioClip.modelData.index); root.controller.setPlayheadMs(root.rawTime(audioClip.mapToItem(viewport, mouse.x, mouse.y).x)) } }
                        }
                    }
                }
            }
            Rectangle {
                visible: root.trimId.length > 0; z: 9
                x: 12 + root.trimStart * root.pixelsPerMs; y: 28
                width: Math.max(1, (root.trimEnd - root.trimStart) * root.pixelsPerMs); height: root.screenHeight - 4
                radius: 5; color: "#443c72b5"; border.width: 2; border.color: Theme.accent
                Text { anchors.centerIn: parent; text: ((root.trimEnd - root.trimStart) / 1000).toFixed(2) + "s"; color: "white"; font.pixelSize: 11 }
            }
            Rectangle { visible: root.movingClips && root.insertionIndex >= 0; z: 11; x: 12 + root.insertionTime() * root.pixelsPerMs; y: 24; width: 3; height: root.trackHeight - 24; color: "#f0c36d" }
            Rectangle { visible: root.ready && root.controller.snapTargetMs >= 0; z: 10; x: 12 + (root.ready ? root.controller.snapTargetMs : 0) * root.pixelsPerMs; width: 1; height: viewport.contentHeight; color: "#b7d5ff" }
            Item {
                objectName: "timelinePlayhead"
                x: 12 + (root.ready ? root.controller.playheadMs : 0) * root.pixelsPerMs - 1; z: 12; width: 2; height: viewport.contentHeight
                Rectangle { width: 2; height: parent.height; color: Theme.accent }
                Rectangle { x: -4; width: 10; height: 10; radius: 3; color: Theme.accent }
            }
        }
    }
    Rectangle {
        id: overview
        anchors { left: parent.left; right: parent.right; bottom: status.top; leftMargin: root.labelWidth + 12; rightMargin: 20; bottomMargin: 5 }
        height: root.interactive ? 18 : 0; visible: root.interactive; radius: 4; color: Theme.railBg; border.color: Theme.strokeSoft
        Rectangle {
            x: viewport.contentX / Math.max(1, viewport.contentWidth) * overview.width
            width: Math.min(overview.width, viewport.width / Math.max(1, viewport.contentWidth) * overview.width); height: parent.height
            radius: 4; color: "#424754"; border.color: "#707885"
        }
        Rectangle { x: root.ready ? root.controller.playheadRatio * parent.width : 0; width: 2; height: parent.height; color: Theme.accent }
        MouseArea {
            anchors.fill: parent
            property real originX: 0
            property real originScroll: 0
            onPressed: mouse => { originX = mouse.x; originScroll = viewport.contentX; root.controller.setPlayheadRatio(mouse.x / Math.max(1, width)); viewport.contentX = Math.max(0, Math.min(viewport.contentWidth - viewport.width, mouse.x / width * viewport.contentWidth - viewport.width / 2)); originScroll = viewport.contentX }
            onPositionChanged: mouse => { if (pressed) viewport.contentX = Math.max(0, Math.min(viewport.contentWidth - viewport.width, originScroll + (mouse.x - originX) / width * viewport.contentWidth)) }
        }
    }
    RowLayout {
        id: status
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 8 }
        height: root.interactive ? 16 : 10
        Text { Layout.fillWidth: true; text: root.ready && root.controller.error.length > 0 ? root.controller.error : root.media && root.media.loading ? "正在分析音频波形…" : root.media && root.media.error.length > 0 ? root.media.error : root.ready && root.controller.selectedFocusId.length > 0 ? "焦点：拖动移动 · 拖两端裁剪 · S 分割 · ⌘C / ⌘V 复制粘贴 · ⇧⌘V 粘贴属性" : root.ready && root.controller.selectedCount > 0 ? "已选 " + root.controller.selectedCount + " 段 · 拖动重排 · 拖边缘裁剪 · Control 拖右边缘变速" : "单击片段选择 · ⌘ 增减选择 · Shift 连选 · 右键更多操作"; elide: Text.ElideRight; color: root.ready && root.controller.error.length > 0 ? Theme.danger : Theme.textFaint; font.pixelSize: 10 }
        Text { text: root.ready ? "成片 " + (root.duration / 1000).toFixed(2) + "s · 原始 " + (root.controller.sourceDurationMs / 1000).toFixed(2) + "s" : ""; color: Theme.textFaint; font.pixelSize: 10 }
    }
}
