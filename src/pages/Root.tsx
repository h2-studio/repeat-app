import { JSXElement, onMount, ParentProps } from "solid-js";
import { Toaster } from "solid-toast";

import Header from "@/components/Header";
import { useService } from "@/service";
import { useNavigate } from "@solidjs/router";

export default function Root(props: ParentProps): JSXElement {
  let service = useService();
  service.setNavigator(useNavigate());

  return (
    <>
      <Header />
      <div class="max-w-screen-lg mx-2 lg:mx-auto">{props.children}</div>
      <Toaster />
    </>
  );
}
