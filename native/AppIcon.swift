import AppKit

// Use a system symbol for the app icon as well as the template status item.
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let side = points * scale, size = CGFloat(side)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NSColor(calibratedWhite: 0.16, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: size * 0.07, y: size * 0.07, width: size * 0.86, height: size * 0.86),
                     xRadius: size * 0.19, yRadius: size * 0.19).fill()
        let symbol = NSImage(systemSymbolName: "arrow.clockwise.circle", accessibilityDescription: nil)!
            .withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [.white]))!
        symbol.draw(in: NSRect(x: size * 0.22, y: size * 0.22, width: size * 0.56, height: size * 0.56))
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("icon_\(points)x\(points)\(suffix).png"))
    }
}
