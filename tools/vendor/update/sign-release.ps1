param(
    [Parameter(Mandatory)][string]$Certificate,
    [Parameter(Mandatory)][string]$Manifest
)
$ErrorActionPreference = 'Stop'
$published = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath $Certificate).Path)
$certificateHash = (Get-FileHash -LiteralPath $Certificate -Algorithm SHA256).Hash
if ($certificateHash -ne '18433D307B60C6962508C20E35E36206851BF69E2683A24FA43B2EC689AE69CA') {
    throw 'The published certificate does not match the fixed Lixing signing identity.'
}
$stored = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $published.Thumbprint)
if ([Convert]::ToBase64String($stored.RawData) -cne [Convert]::ToBase64String($published.RawData)) {
    throw 'The installed signing certificate does not match the published certificate.'
}
$now = Get-Date
if ($now -lt $stored.NotBefore -or $now -gt $stored.NotAfter) { throw 'The signing certificate is outside its validity period.' }
$inputPath = (Resolve-Path -LiteralPath $Manifest).Path
if ([IO.Path]::GetFileName($inputPath) -cne 'lixing-update-manifest.json') { throw 'Expected lixing-update-manifest.json.' }
if ((Get-Item -LiteralPath $inputPath).Length -gt 262144) { throw 'The update manifest exceeds 256 KiB.' }
$key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($stored)
try {
    if ($key -isnot [Security.Cryptography.RSACng] -or $key.Key.IsMachineKey -or $key.KeySize -lt 3072 -or $key.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) {
        throw 'Signing requires the fixed non-exportable CNG key.'
    }
    $bytes = [IO.File]::ReadAllBytes($inputPath)
    $algorithm = [Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [Security.Cryptography.RSASignaturePadding]::Pkcs1
    $signature = $key.SignData($bytes, $algorithm, $padding)
    $outputPath = Join-Path (Split-Path -Parent $inputPath) 'lixing-update-manifest.sig'
    $temporary = $outputPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $output = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew)
        try {
            $output.Write($signature, 0, $signature.Length)
            $output.Flush($true)
        } finally { $output.Dispose() }
        [IO.File]::Move($temporary, $outputPath)
    } finally { [IO.File]::Delete($temporary) }
    Write-Output $outputPath
} finally { if ($key) { $key.Dispose() } }
