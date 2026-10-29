import { useEffect, useRef } from 'react'
import { usePlaidLink } from 'react-plaid-link'

type Props = {
  token: string
  /** Set when a bank (like Citi) sent the person back to us after they signed in on its own site. */
  receivedRedirectUri?: string
  onSuccess: (publicToken: string, institutionName?: string) => void
  /**
   * Called when the person closes Plaid Link without finishing, or Link fails. `status` is Plaid's
   * exit status: 'requires_oauth' means Link is handing the person to their bank's own site.
   */
  onExit: (errorMessage?: string, status?: string) => void
}

/** Renders nothing. Mounting it with a link token opens Plaid Link straight away. */
export default function PlaidLauncher({ token, receivedRedirectUri, onSuccess, onExit }: Props) {
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess: (publicToken, metadata) => {
      if (!publicToken) return onExit('Plaid did not return a token. Please try again.')
      onSuccess(publicToken, metadata.institution?.name ?? undefined)
    },
    onExit: (err, metadata) => {
      console.info('Plaid Link exit', { status: metadata.status, institution: metadata.institution?.name, requestId: metadata.request_id })
      if (!err) return onExit(undefined, metadata.status ?? undefined) // closed, or handed off to the bank
      // Keep the details Plaid support asks for, and show the error code so it can be looked up.
      console.warn('Plaid Link exited with an error', { err, institution: metadata.institution, requestId: metadata.request_id })
      const bank = metadata.institution?.name
      const text = err.display_message || err.error_message || 'Plaid Link failed.'
      onExit(`${bank ? `${bank}: ` : ''}${text} (${err.error_code})`)
    },
  })

  // Open once. React's development double-run of effects must not open it twice.
  const opened = useRef(false)
  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true
      open()
    }
  }, [ready, open])

  return null
}
