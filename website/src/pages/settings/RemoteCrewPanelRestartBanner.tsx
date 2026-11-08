/**
 * Remote Crew's "on, but not active yet" banner. Remote crew management takes
 * effect at the next gateway start, so the banner offers that restart in place:
 * the same `POST /api/restart` and two-step button Settings → About uses, which
 * runs on every install, the desktop app's embedded gateway included. The banner
 * leaves by itself once the restarted gateway is back and the socket's reconnect
 * re-reads the crew list as active.
 *
 * The status region (and the id Connect's `aria-describedby` names) holds the
 * sentence only, so neither announces the button's label as it changes.
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import ErrorNotice from '../../components/ErrorNotice'
import { i18nT } from '../../i18n/t'
import { RestartGatewayButton } from './AboutPanel'
import { RestartToActivateText } from './InstancesPanel'
import { CREW_NEEDS_RESTART_BANNER_ID } from './RemoteCrewPanelCrewRow'

export function RemoteCrewRestartBanner() {
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const restart = useMutation({
    mutationFn: () => api.restartGateway(),
    onMutate: () => setError(null),
    onSuccess: () => setRestarting(true),
    // A restart usually drops the connection before its answer arrives, so only
    // a refusal from the gateway (the owner gate, a launcher that cannot run) fails.
    onError: (e: unknown) => {
      if (e instanceof ApiError) setError(e.message || i18nT('pages.settings.aboutPanel.restart_failed'))
      else setRestarting(true)
    },
  })
  return (
    <div className="px-3 py-2 mb-3 text-[13px] rounded-md bg-warn/10 text-warn-text border border-warn/30">
      <div id={CREW_NEEDS_RESTART_BANNER_ID} role="status" className="flex items-start gap-2">
        <AlertTriangle size={14} className="lucide-inline mt-0.5 shrink-0" />
        <RestartToActivateText />
      </div>
      <div className="mt-2">
        <RestartGatewayButton
          pending={restart.isPending}
          restarting={restarting}
          onConfirm={() => restart.mutate()}
          testId="remote-crew-restart-gateway"
        />
      </div>
      {/* The hand-off is safe: every draft this page holds lives in the store. */}
      {error && <ErrorNotice message={error} variant="inline" askAgent className="mt-2" testId="remote-crew-restart-failed" />}
    </div>
  )
}
