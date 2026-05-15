//
//  ContentView.swift
//  MailroomClip — single-screen address-collection UI.
//
//  Visual language matches the main Mailroom app: cream paper background,
//  serif headlines, postal-blue accents, postal-red CTA. SwiftUI native
//  (no UIKit) so the bundle stays small.
//

import SwiftUI

struct ContentView: View {
    /// The Universal Link the user tapped. We extract `?t=TOKEN` from
    /// here to redeem the claim against the Supabase Edge Function.
    var invocationURL: URL?

    // Form state
    @State private var recipientName: String = ""
    @State private var line1: String = ""
    @State private var line2: String = ""
    @State private var city: String = ""
    @State private var state: String = ""
    @State private var zip: String = ""

    // Submission state
    @State private var submitting: Bool = false
    @State private var didSubmit: Bool = false
    @State private var errorMessage: String?

    /// Computed: extract the token from the invocation URL's `t` query
    /// param. Returns nil if missing — in that case we show a friendly
    /// "Open this link from your message" copy instead of the form.
    private var claimToken: String? {
        guard let url = invocationURL,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let q = comps.queryItems else { return nil }
        return q.first(where: { $0.name == "t" })?.value
    }

    /// Form completeness gate — same shape as the main app's
    /// `isAddressComplete` helper. Name + line1 + city + state (2 letters)
    /// + 5-digit zip. apt/suite is optional.
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
            // Cream paper background — matches the main app
            Color(red: 0.972, green: 0.945, blue: 0.890).ignoresSafeArea()

            if claimToken == nil {
                noLinkView
            } else if didSubmit {
                successView
            } else {
                formView
            }
        }
    }

    // ----- Form ---------------------------------------------------------

    private var formView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Header
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

                // Fields
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

                // Error
                if let err = errorMessage {
                    Text(err)
                        .font(.system(size: 13, design: .serif))
                        .italic()
                        .foregroundColor(postalRed)
                }

                // CTA
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

                // Footer: option to install the full app
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

    // ----- States -------------------------------------------------------

    private var successView: some View {
        VStack(spacing: 16) {
            Text("🎉")
                .font(.system(size: 60))
            Text("Done — your postcard is on its way")
                .font(.system(size: 22, weight: .semibold, design: .serif))
                .foregroundColor(ink)
                .multilineTextAlignment(.center)
            Text("USPS time is 4–7 days. We mailed it from our printer.")
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

    // ----- Field component ---------------------------------------------

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

    // ----- Submission ---------------------------------------------------

    private func submit() {
        guard canSubmit, let token = claimToken else { return }
        submitting = true
        errorMessage = nil

        // Existing Supabase Edge Function — POST /claim with body shape
        // matching what claim/index.ts handlePost() expects.
        let url = URL(string: "https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/claim")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "token": token,
            "name": recipientName,
            "line1": line1,
            "line2": line2,
            "city": city,
            "state": state.uppercased(),
            "zip": zip,
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

    // ----- Palette (matches the main Mailroom app) ---------------------

    private let ink = Color(red: 0.067, green: 0.110, blue: 0.184)
    private let mutedInk = Color(red: 0.412, green: 0.412, blue: 0.412)
    private let postalRed = Color(red: 0.722, green: 0.282, blue: 0.227)
    private let line = Color(red: 0.831, green: 0.788, blue: 0.694)
}

#Preview {
    ContentView(invocationURL: URL(string: "https://mailroomclub.vercel.app/claim?t=ABC123"))
}
