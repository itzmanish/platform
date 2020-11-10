import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { K8SExec } from '../exec';
import { namespace } from '../monitoring';
import { provider, kubeconfig } from '../cluster';
import timescale, { namespace as tsNamespace } from '../timescale';

const cf = new pulumi.Config("dply");

export const database = new K8SExec(
  "grafana-db",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", "CREATE DATABASE grafana;"]
  },
  { dependsOn: timescale }
);

export const dbUser = new K8SExec(
  "grafana-user",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `create user grafana with password '${cf
        .require("grafana_postgres_password")
        .toString()}';`
    ]
  },
  { dependsOn: timescale }
);

export const dbAccess = new K8SExec(
  "grafana-grant",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `GRANT ALL PRIVILEGES ON DATABASE grafana TO grafana`
    ]
  },
  { dependsOn: [...timescale, dbUser, database] }
)

export const creds = new k8s.core.v1.Secret(
  "grafana-credentials",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "grafana-credentials"
    },
    stringData: {
      GF_DATABASE_TYPE: "postgres",
      GF_DATABASE_HOST: "timescale.timescale",
      GF_DATABASE_USER: "grafana",
      GF_DATABASE_NAME: "grafana",
      GF_DATABASE_SSL_MODE: "require",
      GF_DATABASE_PASSWORD: cf.require("grafana_postgres_password")
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "grafana",
  {
    namespace: namespace.metadata.name,
    chart: "grafana",
    fetchOpts: { repo: "https://grafana.github.io/helm-charts" },
    values: {
      envFromSecret: creds.metadata.name,
      adminUser: "admin",
      adminPassword: cf.require("grafana-admin-pass"),
      sidecar: {
        datasources: {
          enabled: true,
        },
      },
    }
  },
  { provider, dependsOn: [...timescale, dbAccess] }
);

export default [
  database,
  dbUser,
  dbAccess,
  creds,
  chart,
]