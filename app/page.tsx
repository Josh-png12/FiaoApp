import { redirect } from "next/navigation";

// El middleware decide: con sesión → /hoy, sin sesión → /login.
export default function Home() {
  redirect("/hoy");
}
