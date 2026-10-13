import { describe, expect, it } from "vitest";
import {
  SPOTIFY_REDIRECT_URI,
  build_spotify_authorize_url,
  compute_pkce_code_challenge,
  generate_pkce_code_verifier,
  read_spotify_authorization_code_from_callback,
} from "./spotify_pkce_auth";

describe("compute_pkce_code_challenge", () => {
  it("is the unpadded base64url SHA-256 of the verifier", async () => {
    // Expected value from: printf %s <verifier> | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='
    const code_challenge = await compute_pkce_code_challenge("dBjftJeZ4CVP-mJ0kZOIQuO9Ys1lIVwTSHnfjNJh1pE");
    expect(code_challenge).toBe("0NvD1h6K578ukS1wsEBLLueHXfQ16FZwE_5ftHPnKXw");
  });
});

describe("generate_pkce_code_verifier", () => {
  it("uses 64 unreserved characters and differs on each call", () => {
    const first_code_verifier = generate_pkce_code_verifier();
    expect(first_code_verifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
    expect(generate_pkce_code_verifier()).not.toBe(first_code_verifier);
  });
});

describe("build_spotify_authorize_url", () => {
  it("asks for a PKCE code with the redirect URI and the three scopes", () => {
    const authorize_url = new URL(
      build_spotify_authorize_url({ spotify_client_id: "client123", code_challenge: "challenge456", state: "state789" }),
    );
    expect(authorize_url.origin + authorize_url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(Object.fromEntries(authorize_url.searchParams)).toEqual({
      client_id: "client123",
      response_type: "code",
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_challenge_method: "S256",
      code_challenge: "challenge456",
      state: "state789",
      scope: "user-library-read user-read-playback-state user-modify-playback-state",
    });
  });
});

describe("read_spotify_authorization_code_from_callback", () => {
  it("returns the code when the state matches", () => {
    expect(read_spotify_authorization_code_from_callback("code=abc&state=xyz", "xyz")).toBe("abc");
  });

  it("rejects a callback whose state does not match", () => {
    expect(() => read_spotify_authorization_code_from_callback("code=abc&state=other", "xyz")).toThrow(/state/);
  });

  it("reports access_denied as a refusal in the browser", () => {
    expect(() => read_spotify_authorization_code_from_callback("error=access_denied&state=xyz", "xyz")).toThrow(
      /denied/,
    );
  });
});
