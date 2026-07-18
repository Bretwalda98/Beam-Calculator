locals {
  name = var.name_prefix
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/beam-calculator/${local.name}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "batch" {
  name              = "/beam-calculator/${local.name}/batch"
  retention_in_days = 30
}

resource "aws_secretsmanager_secret" "cloudflare_tunnel" {
  name                    = "${local.name}/cloudflare-tunnel-token"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "gateway" {
  name                    = "${local.name}/gateway-token"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "session" {
  name                    = "${local.name}/session-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "r2" {
  name                    = "${local.name}/r2-credentials"
  recovery_window_in_days = 7
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "No inbound internet access; cloudflared reaches the API over task localhost."
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "batch" {
  name        = "${local.name}-batch"
  description = "Fargate Batch jobs use outbound HTTPS for R2 and AWS APIs."
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "PostgreSQL access from the CAD/FEM API only."
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "cad_fem" {
  name       = local.name
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "cad_fem" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = "db.t4g.micro"
  allocated_storage            = 30
  max_allocated_storage        = 100
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = var.database_name
  username                     = var.database_username
  manage_master_user_password  = true
  db_subnet_group_name         = aws_db_subnet_group.cad_fem.name
  vpc_security_group_ids       = [aws_security_group.database.id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = 7
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.name}-final"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  apply_immediately            = false
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.cloudflare_tunnel.arn,
      aws_secretsmanager_secret.gateway.arn,
      aws_secretsmanager_secret.session.arn,
      aws_secretsmanager_secret.r2.arn,
      aws_db_instance.cad_fem.master_user_secret[0].secret_arn
    ]
  }
}

resource "aws_iam_role_policy" "ecs_secrets" {
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_secrets.json
}

resource "aws_iam_role" "api_task" {
  name               = "${local.name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "api_batch" {
  statement {
    actions = [
      "batch:SubmitJob",
      "batch:DescribeJobs",
      "batch:TerminateJob"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "api_batch" {
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_batch.json
}

resource "aws_ecs_cluster" "cad_fem" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image
      essential = true
      portMappings = [{
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "8080" },
        { name = "CAD_FEM_DATABASE_HOST", value = aws_db_instance.cad_fem.address },
        { name = "CAD_FEM_DATABASE_PORT", value = tostring(aws_db_instance.cad_fem.port) },
        { name = "CAD_FEM_DATABASE_NAME", value = var.database_name },
        { name = "CAD_FEM_DATABASE_USER", value = var.database_username },
        { name = "CAD_FEM_DATABASE_SSL", value = "true" },
        { name = "CAD_FEM_DATABASE_CA_PATH", value = "/etc/ssl/certs/aws-rds-global-bundle.pem" },
        { name = "CAD_FEM_R2_ENDPOINT", value = var.r2_endpoint },
        { name = "CAD_FEM_R2_BUCKET", value = var.r2_bucket },
        { name = "CAD_FEM_VERIFICATION_STEP_SHA256", value = var.verification_step_sha256 },
        { name = "CAD_FEM_BATCH_JOB_QUEUE", value = aws_batch_job_queue.cad_fem.arn },
        { name = "CAD_FEM_BATCH_JOB_DEFINITION", value = aws_batch_job_definition.native.arn },
        { name = "ALLOWED_ORIGINS", value = var.allowed_origins }
      ]
      secrets = [
        {
          name      = "CAD_FEM_DATABASE_PASSWORD"
          valueFrom = "${aws_db_instance.cad_fem.master_user_secret[0].secret_arn}:password::"
        },
        {
          name      = "CAD_FEM_GATEWAY_TOKEN"
          valueFrom = aws_secretsmanager_secret.gateway.arn
        },
        {
          name      = "SESSION_SECRET"
          valueFrom = aws_secretsmanager_secret.session.arn
        },
        {
          name      = "CAD_FEM_R2_ACCESS_KEY_ID"
          valueFrom = "${aws_secretsmanager_secret.r2.arn}:accessKeyId::"
        },
        {
          name      = "CAD_FEM_R2_SECRET_ACCESS_KEY"
          valueFrom = "${aws_secretsmanager_secret.r2.arn}:secretAccessKey::"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
      command = ["sh", "-c", "npm run db:migrate && npm start"]
    },
    {
      name      = "cloudflared"
      image     = var.cloudflared_image
      essential = true
      command   = ["tunnel", "--no-autoupdate", "run"]
      secrets = [{
        name      = "TUNNEL_TOKEN"
        valueFrom = aws_secretsmanager_secret.cloudflare_tunnel.arn
      }]
      dependsOn = [{
        containerName = "api"
        condition     = "HEALTHY"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "cloudflared"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.cad_fem.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

data "aws_iam_policy_document" "batch_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["batch.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "batch_service" {
  name               = "${local.name}-batch-service"
  assume_role_policy = data.aws_iam_policy_document.batch_assume.json
}

resource "aws_iam_role_policy_attachment" "batch_service" {
  role       = aws_iam_role.batch_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole"
}

resource "aws_iam_role" "batch_task" {
  name               = "${local.name}-batch-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_batch_compute_environment" "cad_fem" {
  compute_environment_name = local.name
  type                     = "MANAGED"
  state                    = "ENABLED"
  service_role             = aws_iam_role.batch_service.arn

  compute_resources {
    type               = "FARGATE"
    max_vcpus          = var.batch_max_vcpus
    subnets            = var.private_subnet_ids
    security_group_ids = [aws_security_group.batch.id]
  }

  depends_on = [aws_iam_role_policy_attachment.batch_service]
}

resource "aws_batch_job_queue" "cad_fem" {
  name     = local.name
  state    = "ENABLED"
  priority = 10

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.cad_fem.arn
  }
}

resource "aws_batch_job_definition" "native" {
  name                  = "${local.name}-native"
  type                  = "container"
  platform_capabilities = ["FARGATE"]
  timeout {
    attempt_duration_seconds = 7200
  }
  retry_strategy {
    attempts = 1
  }

  container_properties = jsonencode({
    image            = var.native_image
    executionRoleArn = aws_iam_role.ecs_execution.arn
    jobRoleArn       = aws_iam_role.batch_task.arn
    resourceRequirements = [
      { type = "VCPU", value = "4" },
      { type = "MEMORY", value = "16384" }
    ]
    networkConfiguration = {
      assignPublicIp = "DISABLED"
    }
    fargatePlatformConfiguration = {
      platformVersion = "LATEST"
    }
    environment = [
      { name = "CAD_FEM_R2_ENDPOINT", value = var.r2_endpoint },
      { name = "CAD_FEM_R2_BUCKET", value = var.r2_bucket },
      { name = "AWS_DEFAULT_REGION", value = "auto" }
    ]
    secrets = [
      {
        name      = "AWS_ACCESS_KEY_ID"
        valueFrom = "${aws_secretsmanager_secret.r2.arn}:accessKeyId::"
      },
      {
        name      = "AWS_SECRET_ACCESS_KEY"
        valueFrom = "${aws_secretsmanager_secret.r2.arn}:secretAccessKey::"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.batch.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "native"
      }
    }
  })
}
