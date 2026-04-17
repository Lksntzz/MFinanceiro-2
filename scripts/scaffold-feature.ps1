param(
  [Parameter(Mandatory = $true)]
  [string]$Name
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-ToKebabCase {
  param([string]$Value)
  $normalized = $Value -replace "[^a-zA-Z0-9]+", "-"
  $normalized = $normalized -replace "([a-z0-9])([A-Z])", '$1-$2'
  return $normalized.Trim("-").ToLowerInvariant()
}

function Convert-ToPascalCase {
  param([string]$Value)
  $parts = ($Value -replace "[^a-zA-Z0-9]+", " ").Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
  return ($parts | ForEach-Object {
      if ($_.Length -eq 1) { $_.ToUpperInvariant() } else { $_.Substring(0, 1).ToUpperInvariant() + $_.Substring(1).ToLowerInvariant() }
    }) -join ""
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$kebab = Convert-ToKebabCase -Value $Name
$pascal = Convert-ToPascalCase -Value $Name

if ([string]::IsNullOrWhiteSpace($kebab)) {
  throw "Nome invalido. Exemplo: fluxo-caixa"
}

$featureRoot = Join-Path $root ("src/features/" + $kebab)
$folders = @(
  $featureRoot,
  (Join-Path $featureRoot "components"),
  (Join-Path $featureRoot "hooks"),
  (Join-Path $featureRoot "services"),
  (Join-Path $featureRoot "schemas"),
  (Join-Path $featureRoot "types"),
  (Join-Path $featureRoot "utils")
)

foreach ($folder in $folders) {
  if (!(Test-Path $folder)) {
    New-Item -ItemType Directory -Path $folder | Out-Null
  }
}

$pagePath = Join-Path $featureRoot ("components/" + $pascal + "Page.tsx")
$servicePath = Join-Path $featureRoot ("services/" + $kebab + ".service.ts")
$schemaPath = Join-Path $featureRoot ("schemas/" + $kebab + ".schema.ts")
$typesPath = Join-Path $featureRoot "types/index.ts"
$indexPath = Join-Path $featureRoot "index.ts"

if (!(Test-Path $pagePath)) {
  @"
import React from 'react';

export function ${pascal}Page() {
  return (
    <section>
      <h1>${pascal}</h1>
      <p>Estrutura inicial da feature ${kebab}.</p>
    </section>
  );
}
"@ | Set-Content -Path $pagePath -Encoding UTF8
}

if (!(Test-Path $servicePath)) {
  @"
export interface ${pascal}Input {
  date: string;
  amount: number;
}

export function validate${pascal}Input(input: ${pascal}Input): boolean {
  return Number.isFinite(input.amount) && input.amount !== 0 && input.date.length > 0;
}
"@ | Set-Content -Path $servicePath -Encoding UTF8
}

if (!(Test-Path $schemaPath)) {
  @"
export const ${pascal}Schema = {
  id: '${kebab}',
  fields: [
    { name: 'date', type: 'string', required: true },
    { name: 'amount', type: 'number', required: true }
  ]
} as const;
"@ | Set-Content -Path $schemaPath -Encoding UTF8
}

if (!(Test-Path $typesPath)) {
  @"
export interface ${pascal}Record {
  id: string;
  user_id: string;
  date: string;
  amount: number;
  category?: string;
  note?: string;
}
"@ | Set-Content -Path $typesPath -Encoding UTF8
}

if (!(Test-Path $indexPath)) {
  @"
export * from './components/${pascal}Page';
export * from './services/${kebab}.service';
export * from './schemas/${kebab}.schema';
export * from './types';
"@ | Set-Content -Path $indexPath -Encoding UTF8
}

Write-Output ("Feature criada em: src/features/" + $kebab)
