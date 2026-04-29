import { POST as markPickedUp } from "@/app/api/driver/orders/[orderId]/picked-up/route";

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  return markPickedUp(req, context);
}

export const PATCH = POST;
