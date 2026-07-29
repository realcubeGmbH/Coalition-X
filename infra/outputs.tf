# =============================================================================
# TERRAFORM OUTPUTS
# =============================================================================

# =============================================================================
# APPLICATION ENDPOINTS
# =============================================================================

output "api_url" {
  description = "URL to access the API"
  value       = var.enable_https ? "https://${var.domain_name != null ? var.domain_name : aws_lb.main.dns_name}" : "http://${aws_lb.main.dns_name}"
}

output "health_check_url" {
  description = "URL for health check endpoint"
  value       = var.enable_https ? "https://${var.domain_name != null ? var.domain_name : aws_lb.main.dns_name}/api/health" : "http://${aws_lb.main.dns_name}/api/health"
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "certificate_arn" {
  description = "ARN of the SSL/TLS certificate"
  value       = var.enable_https ? local.certificate_arn : null
}

output "certificate_status" {
  description = "Status of the certificate validation"
  value       = var.enable_https && var.certificate_arn == null ? aws_acm_certificate.main[0].status : null
}

# =============================================================================
# DATABASE OUTPUTS
# =============================================================================

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "database_name" {
  description = "Name of the database"
  value       = aws_db_instance.main.db_name
}

output "db_credentials_secret_arn" {
  description = "ARN of the database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "database_url_secret_arn" {
  description = "ARN of the DATABASE_URL secret"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "bastion_public_ip" {
  description = "Public IP of the bastion host"
  value       = var.create_bastion ? aws_instance.bastion[0].public_ip : null
}

output "bastion_ssh_tunnel_command" {
  description = "SSH command to tunnel to RDS"
  value       = var.create_bastion ? "ssh -i ~/.ssh/coalition-bastion -f -N -L 15432:${aws_db_instance.main.endpoint}:5432 ec2-user@${aws_instance.bastion[0].public_ip}" : null
}

# =============================================================================
# ECS OUTPUTS
# =============================================================================

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = aws_ecs_service.app.name
}

output "ecs_task_definition_arn" {
  description = "ARN of the ECS task definition"
  value       = aws_ecs_task_definition.app.arn
}

output "migration_task_definition_arn" {
  description = "ARN of the migration task definition"
  value       = aws_ecs_task_definition.migration.arn
}

# =============================================================================
# ECR OUTPUTS
# =============================================================================

output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = aws_ecr_repository.main.repository_url
}

# =============================================================================
# NETWORKING OUTPUTS
# =============================================================================

output "vpc_id" {
  description = "ID of the VPC"
  value       = local.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = aws_subnet.private[*].id
}

# =============================================================================
# DEPLOYMENT COMMANDS
# =============================================================================

output "deploy_commands" {
  description = "Commands to deploy and manage the application"
  value       = <<-EOT
    
    # ============================================
    # PUSH NEW IMAGE TO ECR
    # (--platform linux/amd64: Fargate runs x86_64; build explicitly so it
    #  works from arm64 dev machines / Apple Silicon)
    # ============================================
    aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.main.repository_url}
    docker build --platform linux/amd64 -t ${var.project_name} .
    docker tag ${var.project_name}:latest ${aws_ecr_repository.main.repository_url}:latest
    docker push ${aws_ecr_repository.main.repository_url}:latest

    # ============================================
    # FORCE NEW DEPLOYMENT
    # ============================================
    aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.app.name} --force-new-deployment

    # ============================================
    # RUN DATABASE MIGRATIONS
    # Use the PRIVATE subnets: the task reads DATABASE_URL from Secrets Manager
    # via the VPC endpoint, which is only reachable privately. Public subnets +
    # assignPublicIp=ENABLED fail with a Secrets Manager connection error. The
    # image bundles the Prisma CLI, so no internet is needed for the migration.
    # ============================================
    aws ecs run-task \
      --cluster ${aws_ecs_cluster.main.name} \
      --task-definition ${aws_ecs_task_definition.migration.family} \
      --launch-type FARGATE \
      --network-configuration "awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.ecs_service.id}],assignPublicIp=DISABLED}"
    
    # ============================================
    # VIEW LOGS
    # ============================================
    aws logs tail /ecs/${var.project_name}-${var.environment} --follow
    
  EOT
}

# =============================================================================
# OUTBOUND / TRUST LAYER
# =============================================================================

output "nat_public_ip" {
  description = "The app's fixed outbound address. Allowlist this on the Trust Layer's security group (and anywhere else that restricts callers by IP). Null when create_nat_gateway is false, in which case the tasks have no internet access at all."
  value       = local.nat_eip_public_ip
}

output "connector_token_key_secret_arn" {
  description = "Secrets Manager ARN holding the private JWK the Exchange Layer mints Connector 3 tokens with. Set its value with `aws secretsmanager put-secret-value` — Terraform only creates the placeholder."
  value       = aws_secretsmanager_secret.connector_token_key.arn
}

# =============================================================================
# SUMMARY
# =============================================================================

output "deployment_info" {
  description = "Summary of deployment configuration"
  value = {
    environment    = var.environment
    project_name   = var.project_name
    aws_region     = var.aws_region
    container_port = var.container_port
    app_cpu        = var.app_cpu
    app_memory     = var.app_memory
    desired_count  = var.desired_count
  }
}
