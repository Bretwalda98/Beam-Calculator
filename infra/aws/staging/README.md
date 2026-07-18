# Isolated CAD/FEM staging infrastructure

This Terraform stack is intentionally staging-only and fixed to `eu-west-2`.
It creates:

- a private ECS Fargate API task with a `cloudflared` sidecar and no inbound
  security-group rule;
- encrypted RDS PostgreSQL with an AWS-managed master password;
- an AWS Batch Fargate queue and native job definition;
- Secrets Manager placeholders for the Tunnel token, origin gateway token and
  R2 S3 credentials;
- private security groups and CloudWatch log groups.

Before `terraform plan`, populate immutable image URIs and use existing private
subnets with controlled outbound access. After resources are created, populate
the three secret placeholders out of band. The R2 secret JSON must contain
`accessKeyId` and `secretAccessKey`.

Set `verification_step_sha256` to the reviewed R2 upload of the generated
1000 × 50 × 100 mm axial-bar fixture. The API rejects solve jobs for every
other STEP hash and for altered material, load or mesh settings.

The Cloudflare Tunnel public hostname should route to
`http://localhost:8080` within the ECS task. The public Worker sets the same
`CAD_FEM_GATEWAY_TOKEN` and validates the Cloudflare Access JWT before
forwarding user identity headers.

Do not apply this stack from feature branches. A reviewed staging pipeline must
run `terraform fmt`, `terraform validate`, policy checks and a cost estimate.
Production remains out of scope until security, load, cost and independent
engineering reviews pass.
