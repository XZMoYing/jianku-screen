import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: inspector
    required property var controller
    Keys.onEscapePressed: event => { inspector.controller.cancel(); event.accepted = true }
    Flickable {
        id: scroll
        objectName: "cropInspectorScroll"
        anchors { left: parent.left; right: parent.right; top: parent.top; bottom: footer.top; bottomMargin: 12 }
        contentWidth: width; contentHeight: form.implicitHeight
        boundsBehavior: Flickable.StopAtBounds; clip: true
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
        ColumnLayout {
        id: form
        width: scroll.width - 10
        spacing: 12
        Text { text: "裁切画面"; color: Theme.text; font.pixelSize: 16; font.weight: Font.DemiBold }
        Text { Layout.fillWidth: true; text: "拖动画面内的选框移动，拖动边缘调整范围。确认后应用到整个工程。"; color: Theme.textDim; font.pixelSize: 12; wrapMode: Text.WordWrap }
        Text { text: "原画面 " + inspector.controller.sourceWidth + " × " + inspector.controller.sourceHeight; color: Theme.textFaint; font.pixelSize: 11 }
        GridLayout {
            Layout.fillWidth: true; columns: 2; columnSpacing: 10; rowSpacing: 6
            Text { text: "左边距（像素）"; color: Theme.textDim; font.pixelSize: 11 }
            Text { text: "上边距（像素）"; color: Theme.textDim; font.pixelSize: 11 }
            UiField { id: xField; objectName: "cropXField"; Keys.forwardTo: [inspector]; Layout.fillWidth: true; text: inspector.controller.draftPixels.x; validator: IntValidator { bottom: 0; top: inspector.controller.sourceWidth } }
            UiField { id: yField; objectName: "cropYField"; Keys.forwardTo: [inspector]; Layout.fillWidth: true; text: inspector.controller.draftPixels.y; validator: IntValidator { bottom: 0; top: inspector.controller.sourceHeight } }
            Text { text: "宽度（像素）"; color: Theme.textDim; font.pixelSize: 11 }
            Text { text: "高度（像素）"; color: Theme.textDim; font.pixelSize: 11 }
            UiField { id: widthField; objectName: "cropWidthField"; Keys.forwardTo: [inspector]; Layout.fillWidth: true; text: inspector.controller.draftPixels.width; validator: IntValidator { bottom: 1; top: inspector.controller.sourceWidth } }
            UiField { id: heightField; objectName: "cropHeightField"; Keys.forwardTo: [inspector]; Layout.fillWidth: true; text: inspector.controller.draftPixels.height; validator: IntValidator { bottom: 1; top: inspector.controller.sourceHeight } }
        }
        UiButton {
            objectName: "cropPixelsButton"; Layout.fillWidth: true; text: "应用像素范围"
            enabled: xField.acceptableInput && yField.acceptableInput && widthField.acceptableInput && heightField.acceptableInput
            onClicked: inspector.controller.setDraftPixels({x: Number(xField.text), y: Number(yField.text), width: Number(widthField.text), height: Number(heightField.text)})
        }
        Text { text: "按比例调整选框"; color: Theme.textDim; font.pixelSize: 11 }
        RowLayout {
            Layout.fillWidth: true
            UiButton { Layout.fillWidth: true; text: "16:9"; onClicked: inspector.controller.setAspectRatio(16 / 9) }
            UiButton { Layout.fillWidth: true; text: "1:1"; onClicked: inspector.controller.setAspectRatio(1) }
            UiButton { Layout.fillWidth: true; text: "9:16"; onClicked: inspector.controller.setAspectRatio(9 / 16) }
        }
        UiButton { objectName: "resetCropButton"; Layout.fillWidth: true; text: "恢复完整画面"; onClicked: inspector.controller.resetDraft() }
        Text { Layout.fillWidth: true; visible: text.length > 0; text: inspector.controller.error; color: Theme.danger; font.pixelSize: 11; wrapMode: Text.WordWrap }
        }
    }
    ColumnLayout {
        id: footer
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
        spacing: 10
        Text { Layout.fillWidth: true; text: "原始录制保留完整画面。可以再次裁切或恢复；按 Esc 取消本次调整。"; color: Theme.textFaint; font.pixelSize: 11; wrapMode: Text.WordWrap }
        RowLayout {
            Layout.fillWidth: true
            UiButton { objectName: "cancelCropButton"; Layout.fillWidth: true; text: "取消"; onClicked: inspector.controller.cancel() }
            UiButton { objectName: "applyCropButton"; Layout.fillWidth: true; text: "确认裁切"; tone: "primary"; onClicked: inspector.controller.apply() }
        }
    }
}
