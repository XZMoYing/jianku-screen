import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ScrollView {
    id: inspector
    objectName: "focusInspector"
    property var controller: null
    readonly property var selected: controller ? controller.selectedFocus : ({})
    readonly property bool ready: !!controller && controller.selectedFocusId.length > 0
    readonly property bool scrolling: !!contentItem && !!contentItem.moving
    signal previewRequested()
    clip: true; contentWidth: availableWidth
    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
    ScrollBar.vertical.policy: ScrollBar.AlwaysOn
    function update(properties) { if (ready) controller.updateFocus(controller.selectedFocusId, properties) }
    ColumnLayout {
        width: inspector.availableWidth - 8; spacing: 9
        Text { text: inspector.selected.system ? "自动焦点" : "手动焦点"; color: Theme.text; font.pixelSize: 15; font.weight: Font.DemiBold }
        Text { Layout.fillWidth: true; text: "区间与原始操作关联，剪辑与变速后自动映射。"; color: Theme.textFaint; font.pixelSize: 10; wrapMode: Text.WordWrap }
        UiToggle { Layout.fillWidth: true; label: "启用这个焦点"; checked: !!inspector.selected.enabled; onToggled: value => inspector.update({enabled: value}) }
        RowLayout {
            Layout.fillWidth: true
            UiButton { Layout.fillWidth: true; text: "定位区间"; onClicked: inspector.controller.setPlayheadMs(inspector.selected.outputStartMs) }
            UiButton { Layout.fillWidth: true; text: "预览目标构图"; onClicked: inspector.previewRequested() }
        }
        UiSlider { Layout.fillWidth: true; label: "放大倍率"; from: 1; to: 6; step: .05; decimals: 2; suffix: "×"; value: inspector.selected.zoom || 2; onEdited: value => inspector.update({zoom: value}) }
        UiSegmented { Layout.fillWidth: true; options: ["跟随操作", "固定位置"]; currentIndex: inspector.selected.fixedPosition ? 1 : 0; onActivated: i => inspector.update({fixedPosition: i === 1}) }
        Item {
            objectName: "focusPositionPad"
            Layout.fillWidth: true; Layout.preferredHeight: 92; visible: !!inspector.selected.fixedPosition
            Rectangle { anchors.fill: parent; color: Theme.fieldBg; radius: 6; border.color: Theme.strokeSoft }
            Rectangle { x: parent.width / 2; width: 1; height: parent.height; color: Theme.strokeSoft }
            Rectangle { y: parent.height / 2; height: 1; width: parent.width; color: Theme.strokeSoft }
            Rectangle { x: Math.max(0, Math.min(1, Number(inspector.selected.focusX || 0))) * parent.width - 5; y: Math.max(0, Math.min(1, Number(inspector.selected.focusY || 0))) * parent.height - 5; width: 10; height: 10; radius: 5; color: Theme.accent }
            MouseArea {
                anchors.fill: parent
                function place(x, y) { inspector.update({focusX: Math.max(0, Math.min(1, x / width)), focusY: Math.max(0, Math.min(1, y / height))}) }
                onPressed: mouse => place(mouse.x, mouse.y)
                onPositionChanged: mouse => { if (pressed) place(mouse.x, mouse.y) }
            }
        }
        RowLayout {
            visible: !!inspector.selected.fixedPosition; Layout.fillWidth: true
            Text { text: "X / Y %"; color: Theme.textDim; font.pixelSize: 10 }
            UiField { Layout.fillWidth: true; implicitHeight: 28; text: Number(inspector.selected.focusX * 100).toFixed(1); validator: DoubleValidator { bottom: 0; top: 100; locale: "C" } onEditingFinished: if (acceptableInput) inspector.update({focusX: Number(text) / 100}) }
            UiField { Layout.fillWidth: true; implicitHeight: 28; text: Number(inspector.selected.focusY * 100).toFixed(1); validator: DoubleValidator { bottom: 0; top: 100; locale: "C" } onEditingFinished: if (acceptableInput) inspector.update({focusY: Number(text) / 100}) }
        }
        UiSlider { Layout.fillWidth: true; label: "边缘吸附"; from: 0; to: 1; step: .01; decimals: 2; value: Number(inspector.selected.snapToEdgesRatio || 0); onEdited: value => inspector.update({snapToEdgesRatio: value}) }
        Text { text: "成片起止时间（秒）"; color: Theme.textDim; font.pixelSize: 11 }
        RowLayout {
            Layout.fillWidth: true
            UiField { id: startField; Layout.fillWidth: true; implicitHeight: 30; text: Number(inspector.selected.outputStartMs / 1000).toFixed(3); validator: DoubleValidator { bottom: 0; decimals: 3; locale: "C" } }
            Text { text: "–"; color: Theme.textFaint }
            UiField { id: endField; Layout.fillWidth: true; implicitHeight: 30; text: Number(inspector.selected.outputEndMs / 1000).toFixed(3); validator: DoubleValidator { bottom: 0; decimals: 3; locale: "C" } }
            UiButton { text: "应用"; implicitHeight: 30; enabled: startField.acceptableInput && endField.acceptableInput; onClicked: inspector.controller.setFocusTiming(inspector.controller.selectedFocusId, inspector.selected.clipIndex, Number(startField.text) * 1000, Number(endField.text) * 1000) }
        }
        Text { Layout.fillWidth: true; text: "拖动轨道调整区间；构图预览中可直接在画面上定位。剪辑切点两侧的焦点会分别显示。"; color: Theme.textFaint; font.pixelSize: 10; wrapMode: Text.WordWrap }
        RowLayout {
            Layout.fillWidth: true
            UiButton { Layout.fillWidth: true; text: "复制"; onClicked: inspector.controller.copyFocus() }
            UiButton { Layout.fillWidth: true; text: "粘贴属性"; onClicked: inspector.controller.pasteFocus(-1, true) }
            UiButton { Layout.fillWidth: true; text: "删除"; onClicked: inspector.controller.deleteFocus() }
        }
        UiButton { Layout.fillWidth: true; text: "返回全片设置"; onClicked: inspector.controller.clearSelection() }
    }
}
