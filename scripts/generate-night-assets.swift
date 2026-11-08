// Original geometric artwork and synthesized sound for Tonight Lights Out.
// Rebuild on macOS: swift -module-cache-path /tmp/bedtime-swift-cache scripts/generate-night-assets.swift
import AppKit
import Foundation

let output = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("miniprogram/assets/night")
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ hex: UInt32, _ alpha: CGFloat = 1) {
    color(hex, alpha).setFill(); NSRect(x: x, y: y, width: w, height: h).fill()
}
func line(_ x: CGFloat, _ y: CGFloat, _ xx: CGFloat, _ yy: CGFloat, _ hex: UInt32, _ width: CGFloat = 1) {
    let path = NSBezierPath(); path.move(to: NSPoint(x: x, y: y)); path.line(to: NSPoint(x: xx, y: yy)); path.lineWidth = width; color(hex).setStroke(); path.stroke()
}
func image(_ name: String, width: Int, height: Int, draw: () -> Void) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    context.cgContext.translateBy(x: 0, y: CGFloat(height)); context.cgContext.scaleBy(x: 1, y: -1)
    // An explicitly flipped AppKit context keeps text and geometry aligned.
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name))
}
func sky() {
    let gradient = NSGradient(colors: [color(0x140F1E), color(0x2E2230)])!
    gradient.draw(in: NSRect(x: 0, y: 0, width: 720, height: 660), angle: 90)
    for (x, y, alpha) in [(96.0, 54.0, 0.45), (594, 86, 0.3), (427, 42, 0.22), (198, 110, 0.2), (638, 178, 0.22)] {
        color(0xCEC0CC, alpha).setFill(); NSBezierPath(ovalIn: NSRect(x: x, y: y, width: 2.2, height: 2.2)).fill()
    }
}
func distant() {
    let towers: [(CGFloat, CGFloat, CGFloat)] = [(0, 235, 94), (74, 282, 90), (534, 214, 82), (603, 295, 117)]
    for (x, y, w) in towers {
        rect(x, y, w, 660 - y, 0x191521)
        for row in 0..<7 { for col in 0..<3 where (row + col) % 3 != 1 { rect(x + 15 + CGFloat(col) * 22, y + 28 + CGFloat(row) * 36, 6, 12, 0x3A3340, 0.55) } }
    }
}
func facade() {
    rect(134, 182, 414, 478, 0x0C0A12)
    rect(126, 178, 430, 10, 0x25202B)
    rect(144, 190, 4, 470, 0x1C1623)
    rect(531, 190, 5, 470, 0x1B1621)
    // Five floors of background windows. The user's window lives in WXML.
    for row in 0..<5 {
        let y = CGFloat(218 + row * 88)
        line(150, y + 58, 529, y + 58, 0x1A1520)
        for col in 0..<5 {
            if row == 1 && col == 2 { continue }
            let x = CGFloat(168 + col * 72)
            let lit = (row * 7 + col * 3) % 4 == 0
            rect(x, y, 31, 42, lit ? 0x3A3340 : 0x201B29)
            rect(x + 15, y, 2, 42, 0x100D16)
            rect(x, y + 19, 31, 2, 0x100D16)
            rect(x - 3, y + 42, 37, 3, 0x29212F)
        }
    }
    rect(160, 650, 360, 10, 0x0C0A12)
    // The dark frame remains after the separately rendered user light is out.
    rect(286, 308, 60, 80, 0x17131D)
    rect(289, 311, 54, 74, 0x0C0A12)
}
try image("sky.png", width: 720, height: 660) { sky() }
try image("distant.png", width: 720, height: 660) { distant() }
try image("facade.png", width: 720, height: 660) { facade() }
for active in [false, true] {
    let hex: UInt32 = active ? 0xF0CD96 : 0xB4A8B6
    let suffix = active ? "-active" : ""
    try image("tab-night\(suffix).png", width: 81, height: 81) {
        let frame = NSBezierPath(roundedRect: NSRect(x: 24, y: 17, width: 34, height: 46), xRadius: 4, yRadius: 4)
        frame.lineWidth = 4; color(hex).setStroke(); frame.stroke()
        line(41, 18, 41, 62, hex, 3); line(25, 39, 57, 39, hex, 3)
    }
    try image("tab-me\(suffix).png", width: 81, height: 81) {
        let head = NSBezierPath(ovalIn: NSRect(x: 31, y: 15, width: 20, height: 20)); head.lineWidth = 4; color(hex).setStroke(); head.stroke()
        let body = NSBezierPath(); body.move(to: NSPoint(x: 20, y: 64)); body.curve(to: NSPoint(x: 62, y: 64), controlPoint1: NSPoint(x: 18, y: 32), controlPoint2: NSPoint(x: 64, y: 32)); body.lineWidth = 4; body.stroke()
    }
}
// A short, quiet original sine-based switch sound. No third-party recordings.
let rate = 22050
let frames = Int(Double(rate) * 0.18)
var samples = Data()
for i in 0..<frames {
    let t = Double(i) / Double(rate)
    let envelope = min(1, t / 0.008) * exp(-t * 38)
    let signal = (sin(2 * Double.pi * 330 * t) + 0.3 * sin(2 * Double.pi * 660 * t)) * envelope * 0.18
    var sample = Int16(max(-1, min(1, signal)) * 32767).littleEndian
    withUnsafeBytes(of: &sample) { samples.append(contentsOf: $0) }
}
var wav = Data()
func bytes(_ value: String) { wav.append(value.data(using: .ascii)!) }
func u32(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) } }
func u16(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) } }
bytes("RIFF"); u32(UInt32(36 + samples.count)); bytes("WAVEfmt "); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16); bytes("data"); u32(UInt32(samples.count)); wav.append(samples)
try wav.write(to: output.appendingPathComponent("light-off.wav"))
print("Generated night artwork, icons and original sound. Receipt cards are rendered by the mini-program Canvas.")
