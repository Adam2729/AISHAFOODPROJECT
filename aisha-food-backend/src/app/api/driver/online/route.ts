import { POST as updateDriverStatus } from "@/app/api/driver/status/route";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const nextRequest = new Request(url.toString(), {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ status: "online" }),
  });
  return updateDriverStatus(nextRequest);
}
