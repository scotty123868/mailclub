//
//  ContentView.swift
//  MailroomClip
//
//  The App Clip handles two URL families:
//
//    1. CLAIM    /claim?t=TOKEN       or  /welcome-mail/TOKEN
//       Address-collection form for a recipient who just received a
//       postcard via the share-a-link flow. Submits to the Supabase
//       claim Edge Function and ships the card.
//
//    2. ADD FRIEND   /u/USER_ID?n=Name&c=City&s=State
//       Preview card of a Mailroom user who shared their QR. The clip
//       shows their name + city + emoji avatar. The actual add happens
//       in the full app (auth required) — clip's job is to make the
//       value proposition tangible and get the user to install.
//
//  Build 65: added the ADD FRIEND branch.
//

import SwiftUI

struct ContentView: View {
    /// The Universal Link the user tapped. Extract token or user-id
    /// + display info depending on path shape.
    var invocationURL: URL?

    // Claim form state
    @State private var recipientName: String = ""
    @State private var line1: String = ""
    @State private var line2: String = ""
    @State private var city: String = ""
    @State private var state: String = ""
    @State private var zip: String = ""

    // Submission state (claim flow)
    @State private var submitting: Bool = false
    @State private var didSubmit: Bool = false
    @State private var errorMessage: String?

    /// Build-65 ADD FRIEND route detection. Returns true when the
    /// invocation URL path starts with `/u/`. The token getter below
    /// returns the userId in that case; the body branches to the
    /// add-friend view.
    private var isAddFriendRoute: Bool {
        guard let url = invocationURL,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return false }
        return comps.path.hasPrefix("/u/")
    }

    private var addFriendUserId: String? {
        guard isAddFriendRoute, let url = invocationURL,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        let segments = comps.path.split(separator: "/").map { String($0) }
        // segments[0] == "u", segments[1] == userId
        guard segments.count >= 2 else { return nil }
        let id = segments[1].trimmingCharacters(in: .whitespaces)
        return id.isEmpty ? nil : id
    }

    private var addFriendName: String? {
        guard let url = invocationURL,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let q = comps.queryItems
        else { return nil }
        let raw = q.first(where: { $0.name == "n" })?.value ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var addFriendCity: String? {
        guard let url = invocationURL,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let q = comps.queryItems
        else { return nil }
        let c = (q.first(where: { $0.name == "c" })?.value ?? "").trimmingCharacters(in: .whitespaces)
        let s = (q.first(where: { $0.name == "s" })?.value ?? "").trimmingCharacters(in: .whitespaces)
        if c.isEmpty && s.isEmpty { return nil }
        if !c.isEmpty && !s.isEmpty { return "\(c), \(s)" }
        return c.isEmpty ? s : c
    }

    /// Deterministic emoji for the user id — mirrors the in-app
    /// friendEmoji.ts pool so the App Clip card matches what the
    /// scanner will see once they install + open the app.
    private var addFriendEmoji: String {
        guard let id = addFriendUserId else { return "📮" }
        let pool: [String] = [
            "🐶","🐱","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮",
            "🐷","🐵","🐺","🐴","🦄","🐗","🐹","🐭","🦝","🦡",
            "🦨","🦦","🦥","🦘","🦒","🐘","🦏","🦛","🐪","🦔",
            "🐔","🐧","🦆","🦉","🦚","🦜","🐦","🦢","🐢","🦎",
            "🐠","🐬","🐳","🦈","🐙","🦀","🐌","🦋","🐝","🐞",
            "🌹","🌻","🌷","🌸","🌼","🌺","🪻","🌵","🌴","🌳",
            "🌲","🍀","🌾","🌱","🍄","🌊","🌅","🌈","⭐","✨",
            "🍎","🍊","🍋","🍓","🍇","🍑","🥑","🌶️","🫐","🍉",
            "✉️","📮","🎈","🎁","🖋️","📚","🪁","🎨","⛵","🚲",
            "🗝️","🕯️","🎻","🌍"
        ]
        var h: UInt32 = 5381
        for ch in id.unicodeScalars {
            h = h &* 33 &+ ch.value
        }
        return pool[Int(h % UInt32(pool.count))]
    }

    private var claimToken: String? {
        // v0.7.0.32 — accept BOTH URL shapes the App Clip can be invoked
        // with:
        //   1. /claim?t=TOKEN          (sender-shared link via iMessage)
        //   2. /welcome-mail/TOKEN     (recipient-scanned QR from printed
        //                              postcard back, path-based, no query)
        //
        // Build 55 only parsed the query string, so a QR-launched clip
        // would show "No claim link found" even though the token was
        // in the path. (Codex P1.2.)
        guard let url = invocationURL,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        // Try query string first (?t=TOKEN). Works for /claim flow.
        if let q = comps.queryItems,
           let token = q.first(where: { $0.name == "t" })?.value,
           !token.isEmpty {
            return token
        }
        // Fall back to the last non-empty path segment (e.g. /welcome-mail/TOKEN).
        let segments = comps.path.split(separator: "/").map { String($0) }
        if let last = segments.last, !last.isEmpty {
            return last
        }
        return nil
    }

    private var canSubmit: Bool {
        let zipOK = zip.range(of: "^\\d{5}(-\\d{4})?$", options: .regularExpression) != nil
        return !recipientName.trimmingCharacters(in: .whitespaces).isEmpty
            && !line1.trimmingCharacters(in: .whitespaces).isEmpty
            && !city.trimmingCharacters(in: .whitespaces).isEmpty
            && state.trimmingCharacters(in: .whitespaces).count == 2
            && zipOK
    }

    var body: some View {
        ZStack {
            Color(red: 0.972, green: 0.945, blue: 0.890).ignoresSafeArea()
            if isAddFriendRoute {
                // Build-65 ADD FRIEND branch.
                if addFriendUserId == nil { noLinkView }
                else { addFriendView }
            } else {
                // Existing CLAIM branch.
                if claimToken == nil { noLinkView }
                else if didSubmit { successView }
                else { formView }
            }
        }
    }

    /// Build-65: card shown when scanner opens a /u/{userId} URL in
    /// the App Clip. Shows the shared user's emoji + name + city, then
    /// invites the scanner to get the full app. (The actual add-friend
    /// happens in the full app after install + sign-in.)
    private var addFriendView: some View {
        ScrollView {
            VStack(alignment: .center, spacing: 24) {
                VStack(spacing: 6) {
                    Text("SHARED MAIL CARD")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.6)
                        .foregroundColor(postalRed)
                    Text("A friend wants to swap mail.")
                        .font(.system(size: 26, weight: .semibold, design: .serif))
                        .foregroundColor(ink)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 28)

                // Emoji avatar on a paper disc (matches the in-app
                // friend-emoji avatars).
                ZStack {
                    Circle()
                        .fill(Color(red: 0.984, green: 0.957, blue: 0.855))
                        .frame(width: 110, height: 110)
                    Circle()
                        .stroke(ink, lineWidth: 2)
                        .frame(width: 110, height: 110)
                    Text(addFriendEmoji)
                        .font(.system(size: 56))
                }
                .shadow(color: Color.black.opacity(0.15), radius: 4, y: 2)

                VStack(spacing: 6) {
                    Text(addFriendName ?? "Mailroom member")
                        .font(.system(size: 28, weight: .semibold, design: .serif))
                        .foregroundColor(ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let location = addFriendCity {
                        Text(location)
                            .font(.system(size: 15, design: .serif))
                            .italic()
                            .foregroundColor(postalBlue)
                    }
                }

                Text("Mailroom turns the people you love into real paper postcards. 70¢ each. Their address stays private.")
                    .font(.system(size: 14, design: .serif))
                    .italic()
                    .foregroundColor(mutedInk)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)

                // Primary CTA: Get Mailroom (App Store). Apple's
                // smart-banner overlay typically supplies the install
                // affordance automatically, but having an explicit
                // button removes any doubt.
                Button(action: openAppStore) {
                    Text("Get Mailroom")
                        .font(.system(size: 17, weight: .semibold, design: .serif))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(ink)
                        .cornerRadius(12)
                }

                // Secondary: open the URL in Safari so the smart app
                // banner offers "Open in Mailroom" if installed.
                Button(action: openInBrowser) {
                    Text("Open in Mailroom")
                        .font(.system(size: 15, weight: .medium, design: .serif))
                        .foregroundColor(ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color(red: 0.972, green: 0.945, blue: 0.890))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(ink, lineWidth: 1.5))
                }

                Text("We'll add them to your rolodex automatically once you sign in.")
                    .font(.system(size: 12, design: .serif))
                    .italic()
                    .foregroundColor(mutedInk)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    private func openAppStore() {
        // App Store ID for Mailroom (app-id from apple-itunes-app meta).
        if let url = URL(string: "https://apps.apple.com/app/mailroom/id6747802432") {
            UIApplication.shared.open(url)
        }
    }

    private func openInBrowser() {
        guard let url = invocationURL else { return }
        UIApplication.shared.open(url)
    }

    private var formView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("YOU HAVE MAIL")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.6)
                        .foregroundColor(postalRed)
                    Text("Someone sent you a postcard.")
                        .font(.system(size: 28, weight: .semibold, design: .serif))
                        .foregroundColor(ink)
                        .lineLimit(2)
                    Text("Share your mailing address and we'll print + ship it. Your address stays private.")
                        .font(.system(size: 14, design: .serif))
                        .italic()
                        .foregroundColor(mutedInk)
                        .padding(.top, 4)
                }
                .padding(.top, 24)

                VStack(alignment: .leading, spacing: 16) {
                    field(label: "YOUR NAME", value: $recipientName, placeholder: "Maya Chen")
                    field(label: "STREET ADDRESS", value: $line1, placeholder: "123 Main St")
                    field(label: "APT, SUITE (OPTIONAL)", value: $line2, placeholder: "Apt 4B")
                    HStack(spacing: 12) {
                        field(label: "CITY", value: $city, placeholder: "Denver").frame(maxWidth: .infinity)
                        field(label: "STATE", value: $state, placeholder: "CO").frame(width: 90)
                    }
                    field(label: "ZIP", value: $zip, placeholder: "80218").keyboardType(.numberPad)
                }

                if let err = errorMessage {
                    Text(err)
                        .font(.system(size: 13, design: .serif))
                        .italic()
                        .foregroundColor(postalRed)
                }

                Button(action: submit) {
                    HStack {
                        if submitting { ProgressView().tint(.white) }
                        Text(submitting ? "Sending..." : "Send my address →")
                            .font(.system(size: 16, weight: .semibold, design: .serif))
                            .foregroundColor(.white)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(canSubmit ? ink : ink.opacity(0.4))
                    .cornerRadius(12)
                }
                .disabled(!canSubmit || submitting)

                Text("Want to send your own? Get Mailroom on the App Store after this.")
                    .font(.system(size: 12, design: .serif))
                    .italic()
                    .foregroundColor(mutedInk)
                    .padding(.top, 12)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    private var successView: some View {
        VStack(spacing: 16) {
            Text("🎉").font(.system(size: 60))
            Text("Done — your postcard is on its way")
                .font(.system(size: 22, weight: .semibold, design: .serif))
                .foregroundColor(ink)
                .multilineTextAlignment(.center)
            Text("USPS time is 4-7 days. We mailed it from our printer.")
                .font(.system(size: 14, design: .serif))
                .italic()
                .foregroundColor(mutedInk)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
    }

    private var noLinkView: some View {
        VStack(spacing: 16) {
            Text("No claim link found")
                .font(.system(size: 22, weight: .semibold, design: .serif))
                .foregroundColor(ink)
            Text("Tap the link from your iMessage or email — it has the postcard's claim token attached.")
                .font(.system(size: 14, design: .serif))
                .italic()
                .foregroundColor(mutedInk)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
    }

    private func field(label: String, value: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .tracking(0.8)
                .foregroundColor(mutedInk)
            TextField(placeholder, text: value)
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
                .background(Color.white)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(line, lineWidth: 1))
                .font(.system(size: 15, design: .serif))
        }
    }

    private func submit() {
        guard canSubmit, let token = claimToken else { return }
        submitting = true
        errorMessage = nil

        // v0.7.0.48 FIX (Codex P2.2): canSubmit validates trimmed values,
        // but the POST was sending the raw bindings. A user typing
        // "Brooklyn " with a trailing space passed validation and shipped
        // " Brooklyn " to Lob, where USPS validation can reject it. The
        // web /claim fallback already trims; now the App Clip path
        // matches. ZIP intentionally trims off any user-typed spaces too.
        let trimmedName = recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedLine1 = line1.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedLine2 = line2.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCity = city.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedState = state.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let trimmedZip = zip.trimmingCharacters(in: .whitespacesAndNewlines)

        let url = URL(string: "https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/claim")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "token": token,
            "name": trimmedName,
            "line1": trimmedLine1,
            "line2": trimmedLine2,
            "city": trimmedCity,
            "state": trimmedState,
            "zip": trimmedZip,
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                submitting = false
                if let error = error {
                    errorMessage = error.localizedDescription
                    return
                }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                    errorMessage = body.isEmpty ? "Couldn't save your address. Try again." : body
                    return
                }
                didSubmit = true
            }
        }.resume()
    }

    // Mailroom palette
    private let ink = Color(red: 0.067, green: 0.110, blue: 0.184)
    private let mutedInk = Color(red: 0.412, green: 0.412, blue: 0.412)
    private let postalRed = Color(red: 0.722, green: 0.282, blue: 0.227)
    private let postalBlue = Color(red: 0.235, green: 0.431, blue: 0.561)
    private let line = Color(red: 0.831, green: 0.788, blue: 0.694)
}

#Preview("Claim flow") {
    ContentView(invocationURL: URL(string: "https://app.themailroom.club/claim?t=ABC123"))
}

#Preview("Add friend flow") {
    ContentView(invocationURL: URL(string: "https://app.themailroom.club/u/abc-def-123?n=Maya%20Chen&c=Brooklyn&s=NY"))
}
