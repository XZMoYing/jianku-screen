    func cropMoveGesture(sourceSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                if cropDragOrigin == nil { cropDragOrigin = cropDraft.clamped() }
                guard let origin = cropDragOrigin else { return }
                let x = min(
                    max(origin.x + Double(value.translation.width / max(sourceSize.width, 1)), 0),
                    1 - origin.width
                )
                let y = min(
                    max(origin.y + Double(value.translation.height / max(sourceSize.height, 1)), 0),
                    1 - origin.height
                )
                cropDraft = NormalizedCrop(x: x, y: y, width: origin.width, height: origin.height)
            }
            .onEnded { _ in cropDragOrigin = nil }
    }

    func cropResizeGesture(handle: CropHandle, sourceSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if cropDragOrigin == nil { cropDragOrigin = cropDraft.clamped() }
                guard let origin = cropDragOrigin else { return }
                let dx = Double(value.translation.width / max(sourceSize.width, 1))
                let dy = Double(value.translation.height / max(sourceSize.height, 1))
                cropDraft = resizedCrop(origin, handle: handle, dx: dx, dy: dy)
            }
            .onEnded { _ in cropDragOrigin = nil }
    }

    func resizedCrop(
        _ origin: NormalizedCrop,
        handle: CropHandle,
        dx: Double,
        dy: Double
    ) -> NormalizedCrop {
        let minimumWidth = max(24 / max(Double(sourcePixelSize.width), 1), 0.02)
        let minimumHeight = max(24 / max(Double(sourcePixelSize.height), 1), 0.02)
        var left = origin.x
        var right = origin.x + origin.width
        var top = origin.y
        var bottom = origin.y + origin.height

        switch handle {
        case .topLeft:
            left = min(max(left + dx, 0), right - minimumWidth)
            top = min(max(top + dy, 0), bottom - minimumHeight)
        case .top:
            top = min(max(top + dy, 0), bottom - minimumHeight)
        case .topRight:
            right = max(min(right + dx, 1), left + minimumWidth)
            top = min(max(top + dy, 0), bottom - minimumHeight)
        case .right:
            right = max(min(right + dx, 1), left + minimumWidth)
        case .bottomRight:
            right = max(min(right + dx, 1), left + minimumWidth)
            bottom = max(min(bottom + dy, 1), top + minimumHeight)
        case .bottom:
            bottom = max(min(bottom + dy, 1), top + minimumHeight)
        case .bottomLeft:
            left = min(max(left + dx, 0), right - minimumWidth)
            bottom = max(min(bottom + dy, 1), top + minimumHeight)
        case .left:
            left = min(max(left + dx, 0), right - minimumWidth)
        }

        return NormalizedCrop(x: left, y: top, width: right - left, height: bottom - top).clamped()
    }
