// Schurco Site Audit — SharePoint Upload Edge Function
// Deploy to: Supabase → Edge Functions → sharepoint-upload
// Secrets required: SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

const TENANT_ID     = Deno.env.get('SHAREPOINT_TENANT_ID')!
const CLIENT_ID     = Deno.env.get('SHAREPOINT_CLIENT_ID')!
const CLIENT_SECRET = Deno.env.get('SHAREPOINT_CLIENT_SECRET')!
const SP_HOST       = 'schurcojax.sharepoint.com'
const ROOT_FOLDER   = 'Schurco Site Data Capture'
const CONTRACTS_ROOT_FOLDER = 'Schurco Contracts'

// Microsoft Graph rejects a direct PUT over 4 MiB — anything bigger has to
// go through the chunked upload-session API instead.
const SIMPLE_UPLOAD_LIMIT = 4 * 1000 * 1000

// ── MICROSOFT GRAPH HELPERS ──────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }).toString(),
    }
  )
  const d = await res.json()
  if (!d.access_token) throw new Error('Auth failed: ' + JSON.stringify(d))
  return d.access_token
}

async function getDriveId(token: string): Promise<string> {
  const siteRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:/`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const site = await siteRes.json()
  if (!site.id) throw new Error('SharePoint site not found: ' + JSON.stringify(site))

  const drivesRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const drives = await drivesRes.json()
  const drive = drives.value?.find((d: any) =>
    d.name === 'Documents' || d.name === 'Shared Documents'
  )
  if (!drive) throw new Error('Document library not found')
  return drive.id
}

function sanitize(s: string): string {
  return (s || 'Unknown')
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim() || 'Unknown'
}

async function putFile(
  token: string, driveId: string,
  filePath: string, data: Uint8Array, contentType: string
) {
  // Encode path segments but keep forward slashes
  const encodedPath = filePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/')

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/content`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body:    data,
    }
  )
  const result = await res.json()
  if (result.error) throw new Error(`Upload failed (${filePath}): ${result.error.message}`)
  return result
}

// For files over Graph's 4 MiB direct-upload cap: open a resumable upload
// session and PUT it in chunks (each a multiple of 320 KiB, per Graph's
// requirement). Used only by the "contract" mode below — survey photos and
// the Excel workbook stay small enough for putFile() above.
async function putFileChunked(
  token: string, driveId: string,
  filePath: string, data: Uint8Array
) {
  const encodedPath = filePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/')

  const sessionRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/createUploadSession`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    }
  )
  const session = await sessionRes.json()
  if (!session.uploadUrl) throw new Error(`Could not start upload session (${filePath}): ${JSON.stringify(session)}`)

  const CHUNK_SIZE = 10 * 327680 // ~3.2 MB, a multiple of 320 KiB as Graph requires
  const total = data.length
  let result: any = null

  for (let start = 0; start < total; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, total)
    const chunk = data.subarray(start, end)
    const res = await fetch(session.uploadUrl, {
      method:  'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range':  `bytes ${start}-${end - 1}/${total}`,
      },
      body: chunk,
    })
    result = await res.json()
    if (res.status >= 400) throw new Error(`Chunk upload failed (${filePath}): ${JSON.stringify(result)}`)
  }
  return result
}

async function putFileAuto(
  token: string, driveId: string,
  filePath: string, data: Uint8Array, contentType: string
) {
  return data.length > SIMPLE_UPLOAD_LIMIT
    ? putFileChunked(token, driveId, filePath, data)
    : putFile(token, driveId, filePath, data, contentType)
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const body = await req.json()
    const { mode } = body

    const token   = await getToken()
    const driveId = await getDriveId(token)

    // ── MODE: create ─────────────────────────────────────────────────────────
    // Creates the survey folder and uploads the Excel workbook.
    // Called once per survey share.
    if (mode === 'create') {
      const { survey, excel_base64 } = body

      const safeSite  = sanitize(survey.site || survey.customer)
      const safeCust  = sanitize(survey.customer)
      const date      = (survey.date || new Date().toISOString().slice(0, 10)).replace(/\//g, '-')
      const folderName = `${safeSite}_${safeCust}_${date}`
      const folderPath = `${ROOT_FOLDER}/${folderName}`

      let excelUrl = null

      if (excel_base64) {
        const excelBytes = Uint8Array.from(atob(excel_base64), c => c.charCodeAt(0))
        const result = await putFile(
          token, driveId,
          `${folderPath}/${folderName}.xlsx`,
          excelBytes,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        excelUrl = result.webUrl
      }

      return new Response(JSON.stringify({
        success:     true,
        folder_name: folderName,
        folder_path: folderPath,
        excel_url:   excelUrl,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // ── MODE: photo ───────────────────────────────────────────────────────────
    // Uploads a single photo. Called once per photo slot.
    // Kept small so payloads stay well within limits.
    if (mode === 'photo') {
      const { folder_name, pump_tag, slot_name, photo_base64 } = body

      const safeTag  = sanitize(pump_tag  || 'Pump')
      const safeName = sanitize(slot_name || 'Photo')
      const fileName = `${safeTag}_${safeName}.jpg`
      const filePath = `${ROOT_FOLDER}/${folder_name}/${fileName}`

      const base64Clean = photo_base64.replace(/^data:image\/\w+;base64,/, '')
      const photoBytes  = Uint8Array.from(atob(base64Clean), c => c.charCodeAt(0))

      const result = await putFile(token, driveId, filePath, photoBytes, 'image/jpeg')

      return new Response(JSON.stringify({
        success:   true,
        file_name: fileName,
        url:       result.webUrl,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // ── MODE: contract ───────────────────────────────────────────────────────
    // Uploads a single contract document for the CRM, into its own client
    // subfolder under CONTRACTS_ROOT_FOLDER. Handles files over the 4 MiB
    // simple-upload limit via putFileAuto's chunked fallback.
    if (mode === 'contract') {
      const { client_name, file_name, file_base64, content_type } = body
      if (!file_base64) throw new Error('Missing file_base64')

      const safeClient = sanitize(client_name || 'Unknown_Client')
      const safeFile   = sanitize(file_name || 'Contract.pdf')
      const filePath   = `${CONTRACTS_ROOT_FOLDER}/${safeClient}/${safeFile}`

      const base64Clean = file_base64.replace(/^data:[\w/+-]+;base64,/, '')
      const fileBytes    = Uint8Array.from(atob(base64Clean), c => c.charCodeAt(0))

      const result = await putFileAuto(
        token, driveId, filePath, fileBytes,
        content_type || 'application/octet-stream'
      )

      return new Response(JSON.stringify({
        success:   true,
        file_name: safeFile,
        url:       result.webUrl,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    throw new Error('Unknown mode: ' + mode)

  } catch (e) {
    console.error('[sharepoint-upload]', e)
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status:  500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
