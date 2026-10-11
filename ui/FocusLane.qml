import QtQuick
import QtQuick.Controls

Item {
    id: lane
    property var controller: null
    property var viewport: null
    property var host: null
    property bool automatic: false
    property real pixelsPerMs: 1
    property bool snapping: true
    property bool draftActive: false
    property bool creating: false
    property string draftId: ""
    property int draftClip: -1
    property real draftStart: 0
    property real draftEnd: 0
    property real menuTime: 0
    readonly property var entries: controller ? controller.focusSegments.filter(f => f.system === automatic) : []
    height: 38
    function timeAt(item, x, y) { const p = item.mapToItem(viewport, x, y); return (viewport.contentX + p.x - 12) / pixelsPerMs }
    function finish() {
        const id = draftId, index = draftClip, start = draftStart, end = draftEnd, create = creating
        const commit = draftActive && !host.gestureCancelled
        draftActive = false; creating = false; controller.endSnap()
        if (commit) { if (create) controller.createFocus(start, end); else controller.setFocusTiming(id, index, start, end) }
    }
    Connections {
        target: lane.controller
        function onSelectionChanged() { if (lane.host.gestureCancelled) lane.draftActive = false }
    }
    Rectangle { anchors.fill: parent; color: lane.automatic ? "#201d18" : "#211c2c"; opacity: .8 }
    Text { x: 18 + (lane.viewport ? lane.viewport.contentX : 0); anchors.verticalCenter: parent.verticalCenter; visible: lane.entries.length === 0; text: lane.automatic ? "使用「重建自动焦点」生成区间" : "在空白处拖动添加手动焦点"; color: Theme.textFaint; font.pixelSize: 10 }
    MouseArea {
        id: createMouse
        objectName: lane.automatic ? "automaticFocusBackground" : "manualFocusBackground"
        anchors.fill: parent; acceptedButtons: Qt.LeftButton | Qt.RightButton
        property real initial: 0
        onPressed: mouse => {
            lane.host.forceActiveFocus(); lane.host.gestureCancelled = false
            lane.controller.clearSelection(); lane.controller.beginFocusSnap()
            initial = Math.max(0, Math.min(lane.controller.outputDurationMs, lane.timeAt(createMouse, mouse.x, mouse.y)))
            lane.controller.setPlayheadMs(initial)
            if (mouse.button === Qt.RightButton) { lane.menuTime = initial; backgroundMenu.popup(); return }
            lane.creating = !lane.automatic; lane.draftId = ""; lane.draftClip = -1
            lane.draftStart = initial; lane.draftEnd = initial
        }
        onPositionChanged: mouse => {
            if (!pressed || !lane.creating || lane.host.gestureCancelled || pressedButtons & Qt.RightButton) return
            const at = Math.max(0, Math.min(lane.controller.outputDurationMs, lane.controller.snapFocusTime(lane.timeAt(createMouse, mouse.x, mouse.y), lane.pixelsPerMs, 0, !lane.snapping || !!(mouse.modifiers & Qt.ShiftModifier))))
            lane.draftActive = Math.abs(at - initial) * lane.pixelsPerMs > 6
            lane.draftStart = Math.min(initial, at); lane.draftEnd = Math.max(initial, at)
        }
        onReleased: lane.finish()
        onCanceled: { lane.draftActive = false; lane.creating = false; lane.controller.endSnap() }
    }
    Repeater {
        model: lane.entries
        delegate: Rectangle {
            id: focusClip
            required property var modelData
            objectName: "focusClip-" + modelData.fragmentId
            readonly property bool selected: lane.controller.selectedFocusId === modelData.id
            x: 12 + modelData.outputStartMs * lane.pixelsPerMs
            y: 3; width: Math.max(4, (modelData.outputEndMs - modelData.outputStartMs) * lane.pixelsPerMs - 2); height: 32; radius: 5
            color: lane.automatic ? "#775b31" : "#5d4689"
            border.width: selected ? 2 : 1; border.color: selected ? "#c0a4ff" : "#786879"
            opacity: !modelData.enabled ? .35 : lane.draftActive && lane.draftId === modelData.id && lane.draftClip === modelData.clipIndex ? .4 : 1
            clip: true
            Text { anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; margins: 12 } text: (lane.automatic ? "自动" : "手动") + " · " + Number(focusClip.modelData.zoom).toFixed(2) + "×"; font.pixelSize: 10; color: "#f5eefb"; elide: Text.ElideRight }
            MouseArea {
                id: moveMouse
                anchors.fill: parent; acceptedButtons: Qt.LeftButton | Qt.RightButton; cursorShape: Qt.OpenHandCursor
                property real initialTime: 0
                property var bounds: ({})
                onPressed: mouse => {
                    lane.host.forceActiveFocus(); lane.host.gestureCancelled = false
                    lane.controller.selectFocus(focusClip.modelData.id, focusClip.modelData.clipIndex)
                    initialTime = lane.timeAt(moveMouse, mouse.x, mouse.y)
                    if (mouse.button === Qt.RightButton) { lane.menuTime = initialTime; effectMenu.popup(); return }
                    lane.controller.setPlayheadMs(initialTime)
                    lane.controller.beginFocusSnap(focusClip.modelData.id, focusClip.modelData.clipIndex)
                    bounds = lane.controller.focusBounds(focusClip.modelData.id, focusClip.modelData.clipIndex)
                    lane.draftId = focusClip.modelData.id; lane.draftClip = focusClip.modelData.clipIndex
                    lane.draftStart = focusClip.modelData.outputStartMs; lane.draftEnd = focusClip.modelData.outputEndMs; lane.creating = false
                }
                onPositionChanged: mouse => {
                    if (!pressed || pressedButtons & Qt.RightButton || lane.host.gestureCancelled) return
                    const delta = lane.timeAt(moveMouse, mouse.x, mouse.y) - initialTime
                    if (!lane.draftActive && Math.abs(delta) * lane.pixelsPerMs <= 6) return
                    const length = focusClip.modelData.outputEndMs - focusClip.modelData.outputStartMs
                    const raw = lane.controller.snapFocusTime(focusClip.modelData.outputStartMs + delta, lane.pixelsPerMs, length, !lane.snapping || !!(mouse.modifiers & Qt.ShiftModifier))
                    lane.draftStart = Math.max(bounds.lower, Math.min(bounds.upper - length, raw)); lane.draftEnd = lane.draftStart + length; lane.draftActive = true
                }
                onReleased: lane.finish()
                onCanceled: { lane.draftActive = false; lane.controller.endSnap() }
            }
            Repeater {
                model: [true, false]
                delegate: Item {
                    id: handle
                    required property bool modelData
                    objectName: (modelData ? "focusHead-" : "focusTail-") + focusClip.modelData.fragmentId
                    x: modelData ? 0 : focusClip.width - width; width: Math.min(9, focusClip.width / 3); height: focusClip.height
                    Rectangle { anchors.centerIn: parent; width: 2; height: 18; color: "#f5eefb"; visible: focusClip.selected || edgeMouse.containsMouse }
                    MouseArea {
                        id: edgeMouse
                        anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.SizeHorCursor
                        property var bounds: ({})
                        onPressed: mouse => {
                            lane.host.forceActiveFocus(); lane.host.gestureCancelled = false
                            lane.controller.selectFocus(focusClip.modelData.id, focusClip.modelData.clipIndex)
                            lane.controller.beginFocusSnap(focusClip.modelData.id, focusClip.modelData.clipIndex)
                            bounds = lane.controller.focusBounds(focusClip.modelData.id, focusClip.modelData.clipIndex)
                            lane.draftId = focusClip.modelData.id; lane.draftClip = focusClip.modelData.clipIndex
                            lane.draftStart = focusClip.modelData.outputStartMs; lane.draftEnd = focusClip.modelData.outputEndMs; lane.creating = false
                        }
                        onPositionChanged: mouse => {
                            if (!pressed || lane.host.gestureCancelled) return
                            const time = lane.controller.snapFocusTime(lane.timeAt(edgeMouse, mouse.x, mouse.y), lane.pixelsPerMs, 0, !lane.snapping || !!(mouse.modifiers & Qt.ShiftModifier))
                            if (handle.modelData) lane.draftStart = Math.max(bounds.lower, Math.min(lane.draftEnd - 100, time))
                            else lane.draftEnd = Math.min(bounds.upper, Math.max(lane.draftStart + 100, time))
                            lane.draftActive = true
                        }
                        onReleased: lane.finish()
                        onCanceled: { lane.draftActive = false; lane.controller.endSnap() }
                    }
                }
            }
        }
    }
    Rectangle {
        visible: lane.draftActive && !lane.host.gestureCancelled
        x: 12 + lane.draftStart * lane.pixelsPerMs; y: 3; width: Math.max(1, (lane.draftEnd - lane.draftStart) * lane.pixelsPerMs); height: 32
        color: "#445d4689"; border.width: 2; border.color: "#c0a4ff"; radius: 5
        Text { anchors.centerIn: parent; text: ((lane.draftEnd - lane.draftStart) / 1000).toFixed(2) + "s"; color: "white"; font.pixelSize: 10 }
    }
    Menu {
        id: effectMenu
        MenuItem { text: "复制焦点（⌘C）"; onTriggered: lane.controller.copyFocus() }
        MenuItem { text: "在此处粘贴（⌘V）"; onTriggered: lane.controller.pasteFocus(lane.menuTime) }
        MenuItem { text: "粘贴属性（⇧⌘V）"; onTriggered: lane.controller.pasteFocus(-1, true) }
        MenuSeparator {}
        MenuItem { text: "在播放头处分割（S）"; onTriggered: lane.controller.splitFocus() }
        MenuItem { text: "启用焦点"; checkable: true; checked: !!lane.controller && !!lane.controller.selectedFocus.enabled; onTriggered: lane.controller.updateFocus(lane.controller.selectedFocusId, {enabled: checked}) }
        MenuItem { text: "删除焦点"; onTriggered: lane.controller.deleteFocus() }
    }
    Menu {
        id: backgroundMenu
        MenuItem { text: "在此处粘贴焦点"; onTriggered: lane.controller.pasteFocus(lane.menuTime) }
        MenuItem { text: "重建自动焦点"; visible: lane.automatic; onTriggered: lane.controller.regenerateFocus() }
    }
}
