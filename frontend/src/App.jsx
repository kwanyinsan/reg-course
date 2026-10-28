import { useEffect, useState } from 'react'

function App() {
  const [connection, setConnection] = useState({
    status: 'loading',
    message: 'Waiting for a response from the backend.',
  })
  const [requestNumber, setRequestNumber] = useState(0)

  useEffect(function checkBackendConnection() {
    const controller = new AbortController()
    let ignore = false
    const timeout = setTimeout(function stopSlowRequest() {
      controller.abort()
    }, 10000)

    async function requestStatus() {
      try {
        const response = await fetch('/api/status', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('The backend returned an unsuccessful response.')
        }

        const data = await response.json()

        if (data.status !== 'ok' || typeof data.message !== 'string') {
          throw new Error('The backend returned an unexpected response.')
        }

        if (!ignore) {
          setConnection({ status: 'success', message: data.message })
        }
      } catch (error) {
        if (!ignore) {
          setConnection({
            status: 'error',
            message: error.name === 'AbortError'
              ? 'The connection check timed out. Check that the backend is running and try again.'
              : 'The connection check did not succeed. Check that the backend is running and try again.',
          })
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    requestStatus()

    return function cancelConnectionCheck() {
      ignore = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [requestNumber])

  function handleCheckAgain() {
    setConnection({
      status: 'loading',
      message: 'Waiting for a response from the backend.',
    })
    setRequestNumber(function incrementRequestNumber(previousNumber) {
      return previousNumber + 1
    })
  }

  const isLoading = connection.status === 'loading'
  let statusTitle = 'Checking backend connection…'
  let buttonLabel = 'Checking…'

  if (connection.status === 'success') {
    statusTitle = 'Connected'
    buttonLabel = 'Check again'
  } else if (connection.status === 'error') {
    statusTitle = 'Connection failed'
    buttonLabel = 'Try again'
  }

  return (
    <main className="connection-card" aria-labelledby="page-title">
      <h1 id="page-title">Course registration</h1>
      <p className="subtitle">Development connection check</p>

      <div className={`connection-status ${connection.status}`} role="status" aria-atomic="true">
        <h2>
          <span className="status-indicator" aria-hidden="true" />
          {statusTitle}
        </h2>
        <p>{connection.message}</p>
      </div>

      <button type="button" onClick={handleCheckAgain} disabled={isLoading}>
        {buttonLabel}
      </button>
    </main>
  )
}

export default App
