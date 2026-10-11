import QtQuick

Item {
    id: canvas
    objectName: "cropCanvas"
    required property var controller
    required property var player
    readonly property rect rawRect: { player.width; player.height; return player.sourceDisplayRect }
    readonly property var draft: controller.draft
    readonly property real cropLeft: rawRect.x + draft.x * rawRect.width
    readonly property real cropTop: rawRect.y + draft.y * rawRect.height
    readonly property real cropWidth: draft.width * rawRect.width
    readonly property real cropHeight: draft.height * rawRect.height
    // All gestures use the raw preview's fixed coordinates. The handles move during
    // a drag, so accumulating deltas in a handle's local coordinates would jump.
    Rectangle { x: canvas.rawRect.x; y: canvas.rawRect.y; width: canvas.rawRect.width; height: canvas.cropTop - y; color: "#99000000" }
    Rectangle { x: canvas.rawRect.x; y: canvas.cropTop + canvas.cropHeight; width: canvas.rawRect.width; height: canvas.rawRect.y + canvas.rawRect.height - y; color: "#99000000" }
    Rectangle { x: canvas.rawRect.x; y: canvas.cropTop; width: canvas.cropLeft - x; height: canvas.cropHeight; color: "#99000000" }
    Rectangle { x: canvas.cropLeft + canvas.cropWidth; y: canvas.cropTop; width: canvas.rawRect.x + canvas.rawRect.width - x; height: canvas.cropHeight; color: "#99000000" }
    Rectangle {
        x: canvas.cropLeft; y: canvas.cropTop; width: canvas.cropWidth; height: canvas.cropHeight
        color: "transparent"; border.color: "#eeeeff"; border.width: 1
        Repeater {
            model: 2
            Rectangle { required property int index; x: (index + 1) * parent.width / 3; height: parent.height; width: 1; color: "#66ffffff" }
        }
        Repeater {
            model: 2
            Rectangle { required property int index; y: (index + 1) * parent.height / 3; width: parent.width; height: 1; color: "#66ffffff" }
        }
        MouseArea {
            objectName: "cropMoveArea"; anchors.fill: parent; cursorShape: Qt.SizeAllCursor
            property var origin
            property point start
            onPressed: mouse => { origin = Object.assign({}, canvas.controller.draft); start = mapToItem(canvas, mouse.x, mouse.y) }
            onPositionChanged: mouse => {
                if (!pressed) return
                const pos = mapToItem(canvas, mouse.x, mouse.y)
                canvas.controller.dragDraft(origin, -1, (pos.x - start.x) / canvas.rawRect.width, (pos.y - start.y) / canvas.rawRect.height)
            }
        }
    }
    Repeater {
        model: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]
        Rectangle {
            required property int index
            required property var modelData
            objectName: "cropHandle-" + index
            x: canvas.cropLeft + modelData[0] * canvas.cropWidth - width / 2
            y: canvas.cropTop + modelData[1] * canvas.cropHeight - height / 2
            width: 12; height: 12; radius: 2
            color: "#ffffff"; border.color: "#565463"; border.width: 1
            MouseArea {
                anchors.fill: parent; anchors.margins: -5
                cursorShape: [Qt.SizeFDiagCursor, Qt.SizeVerCursor, Qt.SizeBDiagCursor, Qt.SizeHorCursor, Qt.SizeFDiagCursor, Qt.SizeVerCursor, Qt.SizeBDiagCursor, Qt.SizeHorCursor][parent.index]
                property var origin
                property point start
                onPressed: mouse => { origin = Object.assign({}, canvas.controller.draft); start = mapToItem(canvas, mouse.x, mouse.y) }
                onPositionChanged: mouse => {
                    if (!pressed) return
                    const pos = mapToItem(canvas, mouse.x, mouse.y)
                    canvas.controller.dragDraft(origin, parent.index, (pos.x - start.x) / canvas.rawRect.width, (pos.y - start.y) / canvas.rawRect.height)
                }
            }
        }
    }
}
