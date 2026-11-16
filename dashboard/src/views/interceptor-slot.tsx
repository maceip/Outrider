"use client";

import {CommerceInterceptorView} from "../widgets/commerce-interceptor-view";

export interface InterceptorSlotProps {
  embedded?: boolean;
}

export function InterceptorSlot({embedded = false}: InterceptorSlotProps) {
  return <CommerceInterceptorView embedded={embedded} />;
}
