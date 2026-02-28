import type { OrderStatus } from "@/lib/orderStatus";

export function statusLabelEs(status: OrderStatus): string {
  switch (status) {
    case "new":
      return "Esperando confirmacion";
    case "accepted":
      return "Confirmado";
    case "preparing":
      return "En preparacion";
    case "ready":
      return "Listo";
    case "out_for_delivery":
      return "En camino";
    case "delivered":
      return "Entregado";
    case "cancelled":
      return "Cancelado";
    default:
      return "Actualizando";
  }
}

export function statusProgressPct(status: OrderStatus): number {
  switch (status) {
    case "new":
      return 0;
    case "accepted":
      return 25;
    case "preparing":
      return 50;
    case "ready":
      return 65;
    case "out_for_delivery":
      return 75;
    case "delivered":
      return 100;
    case "cancelled":
      return 100;
    default:
      return 0;
  }
}

export function statusHintEs(status: OrderStatus): string {
  switch (status) {
    case "new":
      return "Esperando que el negocio confirme tu pedido.";
    case "accepted":
      return "El negocio confirmo tu pedido.";
    case "preparing":
      return "El pedido se esta preparando.";
    case "ready":
      return "Pedido listo para salir.";
    case "out_for_delivery":
      return "Pedido en ruta hacia tu direccion.";
    case "delivered":
      return "Pedido entregado.";
    case "cancelled":
      return "El pedido fue cancelado.";
    default:
      return "";
  }
}

