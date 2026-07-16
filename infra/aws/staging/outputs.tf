output "ecs_cluster_arn" {
  value = aws_ecs_cluster.cad_fem.arn
}

output "ecs_service_name" {
  value = aws_ecs_service.api.name
}

output "database_endpoint" {
  value     = aws_db_instance.cad_fem.endpoint
  sensitive = true
}

output "batch_job_queue_arn" {
  value = aws_batch_job_queue.cad_fem.arn
}

output "batch_job_definition_arn" {
  value = aws_batch_job_definition.native.arn
}

output "secrets_to_populate" {
  value = {
    cloudflare_tunnel_token = aws_secretsmanager_secret.cloudflare_tunnel.arn
    gateway_token           = aws_secretsmanager_secret.gateway.arn
    session_secret          = aws_secretsmanager_secret.session.arn
    r2_credentials          = aws_secretsmanager_secret.r2.arn
  }
}
