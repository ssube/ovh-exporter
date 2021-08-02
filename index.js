const { createServer } = require('http');
const ovhClient = require('ovh');
const promClient = require('prom-client');

const config = {
  endpoint: process.env['OVH_ENDPOINT'] || 'ovh-us',
  app: process.env['OVH_APP'] || 'app key required',
  secret: process.env['OVH_SECRET'] || 'app secret required',
  consumer: process.env['OVH_CONSUMER'] || 'consumer key required',
  project: process.env['OVH_PROJECT'] || 'project id required',
  interval: 60000,
  port: 3000,
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
    labelNames: ['bucket'],
    registers: [registry],
  }),
  bucketObjects: new promClient.Gauge({
    name: 'swift_bucket_objects_total',
    help: 'Swift bucket object count',
    labelNames: ['bucket'],
    registers: [registry],
  }),
};

function collectMetrics() {
  console.log('collecting metrics');

  ovh.request('GET', `/cloud/project/${config.project}/storage`, (err, ctrs) => {
    if (err) {
      console.error('error listing Swift containers', err);
      return;
    }

    console.log('listed Swift containers', ctrs.length);

    for (const ctr of ctrs) {
      metrics.bucketBytes.set({
        bucket: ctr.name,
      }, ctr.storedBytes)

      metrics.bucketObjects.set({
        bucket: ctr.name,
      }, ctr.storedObjects)
    }
  });
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
