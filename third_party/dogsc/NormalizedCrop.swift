public struct NormalizedCrop: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double = 0, y: Double = 0, width: Double = 1, height: Double = 1) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public static let full = NormalizedCrop()

    public var left: Double { x }
    public var top: Double { y }
    public var right: Double { 1 - x - width }
    public var bottom: Double { 1 - y - height }

    public func clamped(minimumSize: Double = 0.02) -> NormalizedCrop {
        let minimum = min(max(minimumSize, 0.001), 1)
        let safeX = min(max(x, 0), 1 - minimum)
        let safeY = min(max(y, 0), 1 - minimum)
        return NormalizedCrop(
            x: safeX,
            y: safeY,
            width: min(max(width, minimum), 1 - safeX),
            height: min(max(height, minimum), 1 - safeY)
        )
    }

    public static func fromEdges(
        left: Double,
        right: Double,
        top: Double,
        bottom: Double,
        minimumSize: Double = 0.02
    ) -> NormalizedCrop {
        let minimum = min(max(minimumSize, 0.001), 1)
        let safeLeft = min(max(left, 0), 1 - minimum)
        let safeTop = min(max(top, 0), 1 - minimum)
        let safeRight = min(max(right, 0), 1 - safeLeft - minimum)
        let safeBottom = min(max(bottom, 0), 1 - safeTop - minimum)
        return NormalizedCrop(
            x: safeLeft,
            y: safeTop,
            width: 1 - safeLeft - safeRight,
            height: 1 - safeTop - safeBottom
        )
    }
}
