"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Slot } from "./slot"

/// ป้ายของช่องกรอก — เดิมเป็น `<Label>` ของ Radix ซึ่งข้างในก็คือ `<label>` ธรรมดา
/// บวกพฤติกรรมเดียว (ด้านล่าง) จึงเขียนเองแทนแพ็กเกจที่อยู่นอกรายชื่อ ARC-02
const LABEL_CLASS =
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"

const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<"label"> & { asChild?: boolean }
>(({ className, onMouseDown, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "label"

  return (
    <Comp
      ref={ref}
      className={cn(LABEL_CLASS, className)}
      {...props}
      onMouseDown={(event) => {
        // คลิกบนตัวควบคุมที่อยู่ในป้ายเอง (ปุ่ม ช่องกรอก) ไม่ใช่เรื่องของป้าย
        const target = event.target as HTMLElement
        if (target.closest("button, input, select, textarea")) return

        onMouseDown?.(event)

        // ดับเบิลคลิกที่ป้ายไม่ต้องคลุมดำข้อความ — เหมือนป้ายของ Radix
        if (!event.defaultPrevented && event.detail > 1) event.preventDefault()
      }}
    />
  )
})
Label.displayName = "Label"

export { Label }
