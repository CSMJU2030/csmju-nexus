import * as React from "react"

/// แทน `<Slot>` ของ Radix — ใช้กับ `asChild`: ไม่เรนเดอร์แท็กของตัวเอง
/// แต่ "สวม" props ทั้งหมดลงบนลูกตัวเดียวที่ส่งมา เช่น
/// `<Button asChild><a href="/x">ไป</a></Button>` ได้ <a> ที่หน้าตาเป็นปุ่ม
///
/// กติการวม props เหมือนต้นฉบับทุกข้อ:
///   - className ต่อกัน (ของ Slot ก่อน ของลูกตามหลัง)
///   - style รวมกัน ค่าของลูกชนะ
///   - event handler เรียกทั้งคู่ — ของลูกก่อน แล้วค่อยของ Slot
///   - prop อื่นที่ซ้ำกัน ของลูกชนะ
///   - ref ส่งถึงทั้งผู้เรียกและ ref เดิมของลูก

type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const override: AnyProps = { ...childProps }

  for (const name in childProps) {
    const slotValue = slotProps[name]
    const childValue = childProps[name]

    if (/^on[A-Z]/.test(name)) {
      if (slotValue && childValue) {
        override[name] = (...args: unknown[]) => {
          const result = (childValue as AnyHandler)(...args)
          ;(slotValue as AnyHandler)(...args)
          return result
        }
      } else if (slotValue) {
        override[name] = slotValue
      }
    } else if (name === "style") {
      override[name] = { ...(slotValue as object), ...(childValue as object) }
    } else if (name === "className") {
      override[name] = [slotValue, childValue].filter(Boolean).join(" ")
    }
  }

  return { ...slotProps, ...override }
}

function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.RefObject<T | null>).current = node
    }
  }
}

export const Slot = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }>(
  ({ children, ...slotProps }, forwardedRef) => {
    if (!React.isValidElement<AnyProps>(children)) {
      // ส่งลูกมาหลายตัว = ใช้ผิด ให้ React ฟ้องเหมือนต้นฉบับ
      return React.Children.count(children) > 1 ? React.Children.only(null) : null
    }

    // React 19 เก็บ ref ของ element ไว้ใน props
    const childRef = children.props.ref as React.Ref<HTMLElement> | undefined
    const props = mergeProps(slotProps as AnyProps, children.props)

    if (children.type !== React.Fragment) {
      props.ref = forwardedRef ? composeRefs(forwardedRef, childRef) : childRef
    }

    return React.cloneElement(children, props)
  }
)
Slot.displayName = "Slot"
