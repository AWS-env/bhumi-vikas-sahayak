import SwiftUI
import WatchKit
import AVFoundation

struct ContentView: View {
    @State private var queryText: String = ""
    @State private var ruleNumber: String = ""
    @State private var spokenSummary: String = ""
    @State private var ruleCitation: String = ""
    @State private var isLoading: Bool = false
    
    private let synthesizer = AVSpeechSynthesizer()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    TilakEmblem()
                        .fill(Theme.cream)
                        .frame(width: 24, height: 22)
                        .accessibilityHidden(true)
                    // Matches the web hero wordmark: heavy high-contrast serif with tight tracking.
                    Text("Sarthi")
                        .font(.system(.title2, design: .serif, weight: .bold))
                        .tracking(-1)
                        .foregroundStyle(Theme.cream)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }

                // Voice Recording Button
                VStack(spacing: 4) {
                    Button(action: recordVoiceQuery) {
                        MicButtonLabel(isLoading: isLoading)
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoading)
                    .accessibilityLabel("Ask a rule")

                    Text(isLoading ? "Checking MP Rules…" : "Ask a rule")
                        .font(.footnote)
                        .foregroundStyle(Theme.cream.opacity(0.9))
                }
                .frame(maxWidth: .infinity)

                if !queryText.isEmpty {
                    Text("\"\(queryText)\"")
                        .font(.caption2)
                        .foregroundStyle(Theme.cream.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }

                // Result Card (Meets Hackathon Criteria: Rule # + Citation)
                if !ruleNumber.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(ruleNumber)
                            .font(.system(.caption, design: .serif, weight: .bold))
                            .foregroundStyle(Theme.gold)

                        Text(spokenSummary)
                            .font(.footnote)
                            .foregroundStyle(Theme.cream)

                        Divider().background(Theme.gold.opacity(0.4))

                        Text("Source: " + ruleCitation)
                            .font(.system(size: 9))
                            .foregroundStyle(Theme.cream.opacity(0.6))
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.navyDeep.opacity(0.7))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Theme.gold.opacity(0.3), lineWidth: 0.5)
                    )
                    .clipShape(.rect(cornerRadius: 10))
                }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 50)
        }
        .background {
            ZStack(alignment: .bottom) {
                Theme.navy
                SkylineView()
                    .frame(height: 48)
            }
            .ignoresSafeArea()
        }
    }

    // 1. Voice Recording (Pure Audio Recorder Interface - No Keyboard)
    func recordVoiceQuery() {
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("voice_query.m4a")
        try? FileManager.default.removeItem(at: fileURL)

        let options: [AnyHashable: Any] = [
            WKAudioRecorderControllerOptionsAutorecordKey: true,
            WKAudioRecorderControllerOptionsActionTitleKey: "Ask",
            WKAudioRecorderControllerOptionsAlwaysShowActionTitleKey: true,
            WKAudioRecorderControllerOptionsMaximumDurationKey: 30.0
        ]

        WKApplication.shared().visibleInterfaceController?.presentAudioRecorderController(
            withOutputURL: fileURL,
            preset: .wideBandSpeech,
            options: options
        ) { didSave, error in
            guard didSave, error == nil else { return }
            self.askBackendWithAudio(fileURL: fileURL)
        }
    }

    // 2. Query Backend: audio -> /stt (transcript) -> /chat (cited answer)
    func askBackendWithAudio(fileURL: URL) {
        isLoading = true
        queryText = "Transcribing…"
        ruleNumber = ""
        spokenSummary = ""
        ruleCitation = ""

        Task {
            defer { isLoading = false }
            do {
                let audio = try Data(contentsOf: fileURL)
                let stt: STTResponse = try await BackendAPI.post(
                    "/stt", body: audio, contentType: "audio/mp4"
                )
                let transcript = stt.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !transcript.isEmpty else {
                    showError("Couldn't hear a question. Please try again.")
                    return
                }
                queryText = transcript

                let chatBody = try JSONEncoder().encode(
                    ChatRequest(messages: [.init(role: "user", text: transcript)])
                )
                let chat: ChatResponse = try await BackendAPI.post(
                    "/chat", body: chatBody, contentType: "application/json"
                )

                // The reply uses markdown bold for rule numbers; strip it for display and speech.
                spokenSummary = chat.reply.replacingOccurrences(of: "**", with: "")
                // Sources aren't ordered by relevance, so prefer the rule the answer actually cites.
                let citedRule = chat.reply.firstMatch(of: /Rule (\d+[A-Za-z-]*)/).map { String($0.1) }
                let cited = chat.sources.first { $0.ruleId == citedRule }
                if let top = cited ?? chat.sources.first {
                    ruleNumber = "Rule \(top.ruleId) (\(top.title))"
                    ruleCitation = "MP Bhumi Vikas Rules 2012, PDF page \(top.page)"
                } else {
                    ruleNumber = "Not found"
                    ruleCitation = "MP Bhumi Vikas Rules 2012"
                }
                speak(text: spokenSummary)
            } catch {
                showError(error.localizedDescription)
            }
        }
    }

    private func showError(_ message: String) {
        ruleNumber = "Error"
        spokenSummary = message
        ruleCitation = BackendAPI.baseURL.absoluteString
    }

    // 3. Audio Speech Playback via Watch Speaker
    func speak(text: String) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            print("Audio session configuration error: \(error)")
        }

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-IN")
        utterance.rate = 0.5
        synthesizer.speak(utterance)
    }
}

// MARK: - Backend

/// Talks directly to the FastAPI service in `apps/api`.
private enum BackendAPI {
    /// The Simulator shares the Mac's network, so loopback works; a real watch needs the Mac's LAN IP.
    #if targetEnvironment(simulator)
    static let baseURL = URL(string: "http://127.0.0.1:8000")!
    #else
    static let baseURL = URL(string: "http://\(Secrets.macLANAddress):8000")!
    #endif
    /// Must match `BFF_SHARED_SECRET` in `apps/api/.env` — every route rejects requests without it.
    static let bffSecret = Secrets.bffSharedSecret

    static func post<Response: Decodable>(_ path: String, body: Data, contentType: String) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(bffSecret, forHTTPHeaderField: "x-bff-secret")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 200 else {
            let detail = (try? JSONDecoder().decode(ErrorDetail.self, from: data))?.detail ?? "no detail"
            throw BackendError(message: "\(path) failed (\(status)): \(detail)")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

private struct BackendError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct ErrorDetail: Decodable {
    let detail: String
}

private struct STTResponse: Decodable {
    let transcript: String
}

private struct ChatRequest: Encodable {
    struct Turn: Encodable {
        let role: String
        let text: String
    }
    let messages: [Turn]
}

private struct ChatResponse: Decodable {
    struct Source: Decodable {
        let ruleId: String
        let title: String
        let page: Int

        enum CodingKeys: String, CodingKey {
            case ruleId = "rule_id"
            case title
            case page
        }
    }
    let reply: String
    let sources: [Source]
}

// MARK: - Theme

private enum Theme {
    static let navy = Color(red: 0.10, green: 0.19, blue: 0.38)
    static let navyDeep = Color(red: 0.06, green: 0.12, blue: 0.26)
    static let cream = Color(red: 0.96, green: 0.92, blue: 0.86)
    static let gold = Color(red: 0.85, green: 0.70, blue: 0.50)
}

// MARK: - Mic Button

/// Cream circular mic button surrounded by soft concentric halo rings.
private struct MicButtonLabel: View {
    let isLoading: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.06))
                .frame(width: 86, height: 86)
            Circle()
                .fill(Color.white.opacity(0.08))
                .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 1))
                .frame(width: 72, height: 72)
            Circle()
                .fill(Theme.cream)
                .frame(width: 54, height: 54)
                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)

            if isLoading {
                ProgressView()
                    .tint(Theme.navy)
            } else {
                Image(systemName: "mic")
                    .font(.system(size: 21, weight: .medium))
                    .foregroundStyle(Theme.navy)
            }
        }
        .contentShape(Circle())
    }
}

// MARK: - Tilak Emblem

/// The Sarthi tilak mark from the web favicon (`apps/web/app/icon.svg`):
/// a central double-tapered blade flanked by three tapered bars on each side.
private struct TilakEmblem: Shape {
    /// Bounding box of the glyph in the SVG's coordinate space.
    private static let bounds = CGRect(x: 12.5, y: 9.4, width: 64.6, height: 59.7)

    func path(in rect: CGRect) -> Path {
        // Scale the SVG coordinates uniformly to fit, centred in `rect`.
        let b = Self.bounds
        let scale = min(rect.width / b.width, rect.height / b.height)
        let originX = rect.midX - b.width * scale / 2
        let originY = rect.midY - b.height * scale / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: originX + (x - b.minX) * scale, y: originY + (y - b.minY) * scale)
        }

        var path = Path()

        // Central blade
        path.move(to: pt(45, 9.4))
        path.addLine(to: pt(50.3, 42.5))
        path.addLine(to: pt(45, 69.1))
        path.addLine(to: pt(39.9, 43.2))
        path.closeSubpath()

        // Left-facing bars
        path.move(to: pt(12.5, 29))
        path.addLine(to: pt(20.7, 26.1))
        path.addQuadCurve(to: pt(30.1, 25.8), control: pt(25.7, 25.5))
        path.addLine(to: pt(34.8, 26.4))
        path.addLine(to: pt(34.8, 31.7))
        path.addLine(to: pt(23.1, 31.7))
        path.addQuadCurve(to: pt(12.5, 29), control: pt(17.6, 31.2))
        path.closeSubpath()

        path.move(to: pt(12.8, 41.6))
        path.addLine(to: pt(21.6, 38.1))
        path.addQuadCurve(to: pt(30.8, 38.2), control: pt(26.4, 37.7))
        path.addLine(to: pt(34.8, 38.8))
        path.addLine(to: pt(34.8, 44))
        path.addLine(to: pt(23.2, 44))
        path.addQuadCurve(to: pt(12.8, 41.6), control: pt(17.4, 43.2))
        path.closeSubpath()

        path.move(to: pt(12.5, 54))
        path.addLine(to: pt(20.8, 51.1))
        path.addQuadCurve(to: pt(30.5, 50.9), control: pt(26, 50.5))
        path.addLine(to: pt(34.8, 51.4))
        path.addLine(to: pt(34.8, 56.7))
        path.addLine(to: pt(22.8, 56.7))
        path.addQuadCurve(to: pt(12.5, 54), control: pt(17.2, 55.9))
        path.closeSubpath()

        // Right-facing bars
        path.move(to: pt(55.7, 26.4))
        path.addLine(to: pt(60.3, 25.8))
        path.addQuadCurve(to: pt(69.6, 26.1), control: pt(65.1, 25.5))
        path.addLine(to: pt(77.1, 29))
        path.addLine(to: pt(69.9, 31.6))
        path.addLine(to: pt(55.7, 31.6))
        path.closeSubpath()

        path.move(to: pt(55.7, 38.8))
        path.addLine(to: pt(60.3, 38.1))
        path.addQuadCurve(to: pt(69.6, 38.5), control: pt(65.4, 37.8))
        path.addLine(to: pt(77, 41.8))
        path.addLine(to: pt(69.4, 44))
        path.addLine(to: pt(55.7, 44))
        path.closeSubpath()

        path.move(to: pt(55.7, 51.4))
        path.addLine(to: pt(60.3, 50.9))
        path.addQuadCurve(to: pt(69.6, 51.1), control: pt(65.4, 50.5))
        path.addLine(to: pt(77.1, 54))
        path.addLine(to: pt(69.9, 56.6))
        path.addLine(to: pt(55.7, 56.6))
        path.closeSubpath()

        return path
    }
}

// MARK: - Skyline

/// Stylised Bhopal lakefront: a hill, a domed tower, and water reflections.
private struct SkylineView: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let waterline = h * 0.72

            ZStack(alignment: .topLeading) {
                // Distant hill
                Path { p in
                    p.move(to: CGPoint(x: 0, y: waterline))
                    p.addCurve(
                        to: CGPoint(x: w * 0.75, y: waterline),
                        control1: CGPoint(x: w * 0.2, y: h * 0.15),
                        control2: CGPoint(x: w * 0.5, y: h * 0.2)
                    )
                    p.closeSubpath()
                }
                .fill(Theme.cream.opacity(0.18))

                // Low building row along the shore
                Path { p in
                    let heights: [CGFloat] = [0.08, 0.12, 0.07, 0.14, 0.09, 0.11, 0.06, 0.13, 0.08]
                    let segment = w * 0.7 / CGFloat(heights.count)
                    for (i, bh) in heights.enumerated() {
                        p.addRect(CGRect(x: w * 0.03 + CGFloat(i) * segment, y: waterline - h * bh,
                                         width: segment * 0.8, height: h * bh))
                    }
                }
                .fill(Theme.cream.opacity(0.35))

                // Domed tower on the right
                Path { p in
                    let towerX = w * 0.78
                    let towerW = w * 0.1
                    p.addRect(CGRect(x: towerX, y: h * 0.3, width: towerW, height: waterline - h * 0.3))
                    p.move(to: CGPoint(x: towerX - towerW * 0.1, y: h * 0.3))
                    p.addQuadCurve(
                        to: CGPoint(x: towerX + towerW * 1.1, y: h * 0.3),
                        control: CGPoint(x: towerX + towerW / 2, y: -h * 0.05)
                    )
                    p.closeSubpath()
                    // Pavilion at the tower's base
                    p.addRect(CGRect(x: towerX - w * 0.1, y: waterline - h * 0.2, width: w * 0.3, height: h * 0.2))
                }
                .fill(Theme.gold.opacity(0.85))

                // Water with faint reflection lines
                Rectangle()
                    .fill(Theme.navyDeep.opacity(0.6))
                    .frame(width: w, height: h - waterline)
                    .offset(y: waterline)
                Path { p in
                    var lineY = waterline + 3
                    while lineY < h {
                        p.move(to: CGPoint(x: w * 0.05, y: lineY))
                        p.addLine(to: CGPoint(x: w * 0.95, y: lineY))
                        lineY += 3
                    }
                }
                .stroke(Theme.cream.opacity(0.12), lineWidth: 0.5)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

#Preview {
    ContentView()
}
