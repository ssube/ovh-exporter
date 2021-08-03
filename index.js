const { createServer } = require('http');
const ovhClient = require('ovh');
const promClient = require('prom-client');

const config = {
  endpoint: process.env['OVH_ENDPOINT'] || 'ovh-us',
  app: process.env['OVH_APP'] || 'app key required',
  secret: process.env['OVH_SECRET'] || 'app secret required',
  consumer: process.env['OVH_CONSUMER'] || 'consumer key required',
  project: process.env['OVH_PROJECT'] || 'project id required',
  interval: Number(process.env['OVH_INTERVAL'] || '600000'),
  port: Number(process.env['OVH_PORT'] || '3000'),
}

const ovh = ovhClient({
  endpoint: config.endpoint,
  appKey: config.app,
  appSecret: config.secret,
  consumerKey: config.consumer,
});

ovh.request('GET', '/me', (err, me) => {
  if (err) {
    console.error('error connecting to OVH API', err);
    process.exit(1);
  } else {
    console.log('connected to OVH API', me.nichandle);
  }
});

const registry = new promClient.Registry();
promClient.collectDefaultMetrics({
  register: registry,
});

const metrics = {
  bucketBytes: new promClient.Gauge({
    name: 'swift_bucket_bytes_total',
    help: 'Swift bucket size in bytes',
    labelNames: ['bucket', 'region'],
    registers: [registry],
  }),
  bucketObjects: new promClient.Gauge({
    name: 'swift_bucket_objects_total',
    help: 'Swift bucket object count',
    labelNames: ['bucket', 'region'],
    registers: [registry],
  }),
  quotaMax: new promClient.Gauge({
    name: 'project_quota_max',
    help: 'project max resource quotas',
    labelNames: ['region', 'resource'],
    registers: [registry],
  }),
  quotaUsed: new promClient.Gauge({
    name: 'project_quota_used',
    help: 'project used resource quotas',
    labelNames: ['region', 'resource'],
    registers: [registry],
  }),
};

function collectSwiftContainers() {
  ovh.request('GET', `/cloud/project/${config.project}/storage`, (err, ctrs) => {
    if (err) {
      console.error('error listing Swift containers', err);
      return;
    }

    console.log('listed Swift containers', ctrs.length);

    for (const ctr of ctrs) {
      metrics.bucketBytes.set({
        bucket: ctr.name,
        region: ctr.region,
      }, ctr.storedBytes)

      metrics.bucketObjects.set({
        bucket: ctr.name,
        region: ctr.region,
      }, ctr.storedObjects)
    }
  });
}

function collectQuotas() {
  ovh.request('GET', `/cloud/project/${config.project}/quota`, (err, quotas) => {
    if (err) {
      console.error('error getting project quota', err);
      return;
    }

    console.log('got project quota', quotas.length);

    for (const quota of quotas) {
      if (quota.instance === null) {
        continue;
      }

      metrics.quotaUsed.set({
        region: quota.region,
        resource: 'cores',
      }, quota.instance.usedCores);

      metrics.quotaMax.set({
        region: quota.region,
        resource: 'cores',
      }, quota.instance.maxCores);

      metrics.quotaUsed.set({
        region: quota.region,
        resource: 'instances',
      }, quota.instance.usedInstances);

      metrics.quotaMax.set({
        region: quota.region,
        resource: 'instances',
      }, quota.instance.maxInstances);

      metrics.quotaUsed.set({
        region: quota.region,
        resource: 'memory',
      }, quota.instance.usedRAM);

      metrics.quotaMax.set({
        region: quota.region,
        resource: 'memory',
      }, quota.instance.maxRam);
    }
  });
}

function collectMetrics() {
  console.log('collecting metrics');

  collectQuotas();
  collectSwiftContainers();
}

function serveMetrics(req, res) {
  console.log('serving metrics');
  registry.metrics().then((data) => {
    res.end(data);
  });
}

const server = createServer(serveMetrics);
server.listen(config.port, () => {
  console.log('server listening');
});

const collector = setInterval(collectMetrics, config.interval);
collectMetrics();

function stop() {
  console.log('closing');
  clearInterval(collector);
  server.close();
}

// on signal, clear interval and close server
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
