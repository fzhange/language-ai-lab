import * as Tooltip from '@radix-ui/react-tooltip'
import type { ButtonHTMLAttributes } from 'react'

export default function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" aria-label={label} {...props}>{children}</button></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{label}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>
}
