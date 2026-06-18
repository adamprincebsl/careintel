// Beacon Care Intelligence — SWA + Functions + Cosmos (Serverless) + AOAI wiring.
//
// Deploys into the shared RG-SWA-Prod resource group alongside the other Beacon
// micro-apps (beacon-dispatch, beacon-opportunity, ...). This app:
//   * provisions its OWN Cosmos account for its own data (saved reports, chat
//     sessions, cached AI insights, predictive signals);
//   * reads the cap app's Cosmos (cosmos-beacon-capapp / capapp) READ-ONLY for
//     the system-of-record care data it reports on;
//   * calls an existing Azure OpenAI resource for its AI features.
//
// Auth: SWA enforces Entra at the edge. The Function App's system-assigned
// managed identity gets:
//   * Cosmos DB Built-in Data Contributor on its OWN account (read/write);
//   * Cosmos DB Built-in Data Reader on the cap account (read-only) — attempted
//     here, falls back to scripts/grant-cap-read.sh if the deployer lacks rights;
//   * Cognitive Services OpenAI User on the AOAI account (when provided);
//   * Key Vault Secrets User on the shared vault.

// -----------------------------------------------------------------------------
// Parameters
// -----------------------------------------------------------------------------

@description('App slug, lowercase, hyphenated.')
@minLength(3)
@maxLength(20)
param appName string = 'care-intelligence'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Name of the shared Key Vault holding all app secrets.')
param sharedKeyVaultName string = 'KV-SWA-APPS'

@description('Enable Cosmos free tier (1000 RU/s + 25 GB). Only one Cosmos account per subscription can claim it — set false if another account already has it.')
param enableCosmosFreeTier bool = false

@description('Cosmos database name within this app\'s account. Defaults to the app slug.')
param cosmosDatabaseName string = appName

@description('Default container the Functions read when no name is passed (cosmos.js COSMOS_CONTAINER_DEFAULT).')
param defaultContainerName string = 'reports'

@description('Name of the cap app Cosmos account this app reads care data from (read-only).')
param capCosmosAccountName string = 'cosmos-beacon-capapp'

@description('Database within the cap Cosmos account holding caps/risks/audits/locations.')
param capCosmosDatabaseName string = 'capapp'

@description('Resource group of the cap Cosmos account (it lives in its own RG).')
param capCosmosResourceGroup string = 'RG-CAPAPP-Prod'

@description('c360 Fabric warehouse SQL endpoint (read-only client-360 data). Empty disables c360 features.')
param fabricC360SqlEndpoint string = '4trxo4y44m3e7byjyu2g7pz6le-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com'

@description('c360 Fabric warehouse name / initial catalog.')
param fabricC360WarehouseName string = 'core-prod-db'

@description('Curated c360 view the app reads client display data from (we never query base tables).')
param fabricC360ClientView string = 'dbo.vw_Client'

@description('Approved deep-link template to the full client record in the DW (Power BI / Fabric). {clientId} is substituted. Empty disables the link-back.')
param c360DwLinkTemplate string = ''

@description('Existing Azure OpenAI account name to grant the Function App access to. Empty => AI runs in mock mode and no RBAC is assigned.')
param aoaiAccountName string = ''

@description('Resource group of the Azure OpenAI account. Defaults to this RG.')
param aoaiResourceGroup string = resourceGroup().name

@description('Azure OpenAI endpoint. Empty => AI features run in deterministic mock mode.')
param aoaiEndpoint string = ''

@description('Azure OpenAI chat deployment name. Empty => mock mode.')
param aoaiDeployment string = ''

@description('Public base URL of the dashboard, used for deep links in saved reports / insights.')
param dashboardUrl string = ''

// This app's own containers. `insights` carries a 1-day TTL so cached AI
// narratives self-prune; everything else is durable.
// `insights` carries a 1-day TTL; `aiTurns` a 90-day TTL (transcripts may echo
// PHI even though no source rows are stored — see C360_INTELLIGENCE_PLAN.md §2).
// Everything else is durable. All containers are PHI-FREE.
var containers = [
  { name: 'reports',       pk: '/pk',        ttl: -1 }
  { name: 'chatSessions',  pk: '/sessionId', ttl: -1 }
  { name: 'insights',      pk: '/pk',        ttl: 86400 }
  { name: 'signals',       pk: '/pk',        ttl: -1 }
  { name: 'users',         pk: '/pk',        ttl: -1 }
  { name: 'c360Schema',    pk: '/pk',        ttl: -1 }
  { name: 'c360Snapshots', pk: '/pk',        ttl: -1 }
  { name: 'c360Vectors',   pk: '/pk',        ttl: -1 }
  { name: 'aiTurns',       pk: '/userOid',   ttl: 7776000 }
  { name: 'aiBudgets',     pk: '/pk',        ttl: -1 }
  { name: 'accessLog',     pk: '/pk',        ttl: -1 }
  { name: 'appSettings',   pk: '/pk',        ttl: -1 }
  { name: 'auditLog',      pk: '/pk',        ttl: -1 }
  { name: 'roles',         pk: '/pk',        ttl: -1 }
]

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

var storageName = take('st${replace(appName, '-', '')}${uniqueString(resourceGroup().id)}', 24)
var functionAppName = 'func-beacon-${appName}'
var planName = 'plan-beacon-${appName}'
var swaName = 'swa-beacon-${appName}'
var appInsightsName = 'appi-beacon-${appName}'
var newCosmosAccountName = 'cosmos-beacon-${appName}'

// -----------------------------------------------------------------------------
// Storage Account (required for Functions runtime)
// -----------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// -----------------------------------------------------------------------------
// Application Insights
// -----------------------------------------------------------------------------

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
}

// -----------------------------------------------------------------------------
// Cosmos DB (Serverless) — this app's own account
// -----------------------------------------------------------------------------

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: newCosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: enableCosmosFreeTier
    capabilities: [
      { name: 'EnableServerless' }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    disableLocalAuth: false
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in containers: {
  parent: cosmosDb
  name: c.name
  properties: {
    resource: {
      id: c.name
      partitionKey: {
        paths: [ c.pk ]
        kind: 'Hash'
      }
      defaultTtl: c.ttl
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
      }
    }
  }
}]

// Existing cap app Cosmos account (in its own RG) — referenced cross-RG only to
// wire its endpoint into app settings. The read-only role assignment is granted
// out-of-band by scripts/grant-cap-read.sh (a role assignment can't be written
// into another RG from this deployment).
resource capCosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: capCosmosAccountName
  scope: resourceGroup(capCosmosResourceGroup)
}

// -----------------------------------------------------------------------------
// Function App (Linux B1 dedicated, Node 20)
//
// RG-SWA-Prod does not allow Linux *dynamic* (Y1 consumption) workers, so we use
// a Linux Basic (B1) dedicated plan — same config as the sibling Beacon apps.
// -----------------------------------------------------------------------------

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      alwaysOn: true
      linuxFxVersion: 'Node|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'APP_NAME', value: appName }
        { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
        { name: 'COSMOS_CONTAINER_DEFAULT', value: defaultContainerName }
        { name: 'SHARED_KV_NAME', value: sharedKeyVaultName }
        { name: 'CAP_COSMOS_ENDPOINT', value: capCosmos.properties.documentEndpoint }
        { name: 'CAP_COSMOS_DATABASE', value: capCosmosDatabaseName }
        { name: 'FABRIC_C360_SQL_ENDPOINT', value: fabricC360SqlEndpoint }
        { name: 'FABRIC_C360_WAREHOUSE_NAME', value: fabricC360WarehouseName }
        { name: 'FABRIC_C360_CLIENT_VIEW', value: fabricC360ClientView }
        { name: 'C360_DW_LINK_TEMPLATE', value: c360DwLinkTemplate }
        { name: 'AOAI_ENDPOINT', value: aoaiEndpoint }
        { name: 'AOAI_DEPLOYMENT', value: aoaiDeployment }
        { name: 'DASHBOARD_URL', value: dashboardUrl }
      ]
    }
  }
}

// -----------------------------------------------------------------------------
// Static Web App (Standard tier, with linked Function backend)
// -----------------------------------------------------------------------------

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    buildProperties: {
      appLocation: 'web'
      apiLocation: ''
      outputLocation: ''
    }
  }
}

resource swaBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'backend'
  properties: {
    backendResourceId: functionApp.id
    region: location
  }
}

// -----------------------------------------------------------------------------
// RBAC — Key Vault secrets read
// -----------------------------------------------------------------------------

resource sharedKv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: sharedKeyVaultName
}

var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

resource kvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: sharedKv
  name: guid(sharedKv.id, functionApp.id, kvSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// -----------------------------------------------------------------------------
// RBAC — Cosmos DB Built-in Data Contributor on this app's OWN account
//
// Cosmos data-plane role assignments are NOT regular Azure RBAC — they live on
// the Cosmos account itself as sqlRoleAssignments. Built-in role ...0002 grants
// read/write on data.
// -----------------------------------------------------------------------------

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionApp.id, '00000000-0000-0000-0000-000000000002')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: functionApp.identity.principalId
    scope: cosmosAccount.id
  }
}

// -----------------------------------------------------------------------------
// RBAC — Cognitive Services OpenAI User on the AOAI account (optional)
// -----------------------------------------------------------------------------

resource aoaiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (!empty(aoaiAccountName)) {
  name: aoaiAccountName
  scope: resourceGroup(aoaiResourceGroup)
}

// NOTE: when the AOAI account is in this same RG, this assigns the role. When
// it's cross-RG, deploy a small module scoped to that RG (see PLAN.md) or grant
// out-of-band. Left here for the common same-RG case.
var aoaiUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908' // Cognitive Services OpenAI User

resource aoaiAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(aoaiAccountName) && aoaiResourceGroup == resourceGroup().name) {
  scope: aoaiAccount
  name: guid(aoaiAccount.id, functionApp.id, aoaiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', aoaiUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// NOTE: read-only access for this app's managed identity on the cap Cosmos
// account is granted out-of-band (cross-RG role assignment can't be written
// from this deployment) — run scripts/grant-cap-read.sh after the MI exists.

// NOTE: read-only access to the c360 Fabric warehouse (core-prod-db) is granted
// in the Fabric portal, NOT here — Fabric workspace grants aren't Azure RBAC and
// can't be expressed in Bicep. After this deploy creates the Function App's
// managed identity, a Fabric workspace owner adds it as Viewer on the workspace
// (same procedure as the cap app's docs/FABRIC_SETUP.md). Confirm via
// GET /api/internal/c360-health.

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------

output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output storageAccountName string = storage.name
output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseName string = cosmosDatabaseName
output capCosmosEndpoint string = capCosmos.properties.documentEndpoint
output functionAppPrincipalId string = functionApp.identity.principalId
