export class NextResponse extends Response {
  static json(body, init = {}) {
    return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  }
}
