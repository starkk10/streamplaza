import { CartView } from "@/components/cart";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Carrito" };

export default async function CartPage() {
  const user = await getCurrentUser();
  return <CartView loggedIn={!!user} />;
}
