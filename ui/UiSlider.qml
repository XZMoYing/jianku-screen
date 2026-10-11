import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root
    property string label: ""
    property string detail: ""
    property real value: 0
    property real from: 0
    property real to: 100
    property real step: 1
    property int decimals: 0
    property string suffix: ""
    signal edited(real value)

    implicitHeight: detail.length > 0 ? 64 : 46

    ColumnLayout {
        anchors.fill: parent
        spacing: 3

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Text {
                text: root.label
                color: Theme.text
                font.pixelSize: 12
            }
            Item { Layout.fillWidth: true }
            Text {
                text: root.value.toFixed(root.decimals) + root.suffix
                color: Theme.textDim
                font.pixelSize: 11
            }
        }

        Text {
            visible: root.detail.length > 0
            Layout.fillWidth: true
            text: root.detail
            color: Theme.textFaint
            font.pixelSize: 10
            elide: Text.ElideRight
        }

        Slider {
            id: slider
            objectName: "parameterControl_" + root.label
            Layout.fillWidth: true
            Layout.preferredHeight: 18
            from: root.from
            to: root.to
            stepSize: root.step
            value: root.value
            onMoved: root.edited(value)
            onPressedChanged: if (!pressed) root.edited(value)

            Connections {
                target: root
                function onValueChanged() {
                    if (!slider.pressed)
                        slider.value = root.value
                }
            }

            background: Rectangle {
                x: slider.leftPadding
                y: slider.topPadding + slider.availableHeight / 2 - 2
                width: slider.availableWidth
                height: 4
                radius: 2
                color: Theme.fieldBg
                Rectangle {
                    width: slider.visualPosition * parent.width
                    height: parent.height
                    radius: 2
                    color: Theme.accent
                }
            }
            handle: Rectangle {
                x: slider.leftPadding + slider.visualPosition * (slider.availableWidth - width)
                y: slider.topPadding + slider.availableHeight / 2 - height / 2
                width: 14
                height: 14
                radius: 7
                color: slider.pressed ? Theme.accent : "#f2f2f4"
                border.width: 1
                border.color: "#30000000"
            }
        }
    }
}
