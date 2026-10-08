export function readGoogleAccessToken(request: Request): string | null {
    const value = request.headers.get('x-google-access-token');
    if (!value) {
        return null;
    }
    const token = value.trim();
    if (token.length < 20 || token.length > 4096) {
        return null;
    }
    return token;
}
