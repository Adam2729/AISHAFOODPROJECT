import { POST as updateDriverOrderStatus } from "@/app/api/driver/orders/[orderId]/status/route";

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const url = new URL(req.url);
  const nextRequest = new Request(url.toString(), {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ action: "picked_up" }),
  });
  return updateDriverOrderStatus(nextRequest, context);
}

export const PATCH = POST;
