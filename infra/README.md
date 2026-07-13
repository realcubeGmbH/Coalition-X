# Exchange Layer - Terraform Infrastructure

This Terraform configuration deploys the Exchange Layer (Coalition X API) to AWS ECS Fargate.

## Architecture

```
Internet → ALB (HTTP:80) → ECS Fargate → RDS PostgreSQL
                              ↓
                        Secrets Manager
                        (DB creds, JWT)
```

## What Gets Created

| Resource | Description | Cost (approx) |
|----------|-------------|---------------|
| VPC | Network with public/private subnets | Free |
| RDS PostgreSQL 16 | Database (db.t3.micro) | ~$15/mo |
| ECS Fargate | Container runtime (0.5 vCPU, 1GB) | ~$15/mo |
| ALB | Load balancer | ~$20/mo |
| ECR | Container registry | ~$1/mo |
| Secrets Manager | Stores credentials | ~$2/mo |
| VPC Endpoints | Private AWS access | ~$8/mo |
| **Total** | | **~$61/mo** |

## Prerequisites

1. [Terraform](https://www.terraform.io/downloads) >= 1.0
2. [AWS CLI](https://aws.amazon.com/cli/) configured
3. Docker image pushed to ECR (or will be created)

## Quick Start

### 1. Initialize Terraform

```bash
cd infra_new
terraform init
```

### 2. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars if needed (defaults work for dev)
```

### 3. Deploy

```bash
terraform plan     # Preview changes
terraform apply    # Create everything (type 'yes')
```

⏱️ Takes ~15 minutes (RDS is slow to create)

### 4. Get Your API URL

```bash
terraform output api_url
# http://exchange-layer-dev-alb-xxx.eu-central-1.elb.amazonaws.com
```

### 5. Push Docker Image

```bash
# Get ECR login
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin $(terraform output -raw ecr_repository_url | cut -d'/' -f1)

# Build and push
# --platform linux/amd64: Fargate runs x86_64; required when building from
# an arm64 machine (Apple Silicon) or the task fails with "exec format error".
docker build --platform linux/amd64 -t exchange-layer ..
docker tag exchange-layer:latest $(terraform output -raw ecr_repository_url):latest
docker push $(terraform output -raw ecr_repository_url):latest

# Force ECS to pull new image
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw ecs_service_name) \
  --force-new-deployment
```

### 6. Run Database Migrations

```bash
# View the migration command
terraform output deploy_commands

# Or run directly:
aws ecs run-task \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --task-definition exchange-layer-dev-migration \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=$(terraform output -json private_subnet_ids | jq -r 'join(",")'),securityGroups=[$(terraform output -raw ecs_security_group_id 2>/dev/null || echo "")],assignPublicIp=DISABLED}"
```

## Useful Commands

```bash
# View all outputs
terraform output

# View logs
aws logs tail /ecs/exchange-layer-dev --follow

# Check ECS service status
aws ecs describe-services \
  --cluster exchange-layer-dev-cluster \
  --services exchange-layer-dev-service

# Get DATABASE_URL from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id $(terraform output -raw database_url_secret_arn) \
  --query SecretString --output text
```

## Destroying Infrastructure

⚠️ **Warning**: This deletes everything including the database!

```bash
terraform destroy
```

## Troubleshooting

### ECS task not starting

1. Check logs:
   ```bash
   aws logs tail /ecs/exchange-layer-dev --follow
   ```

2. Check task status:
   ```bash
   aws ecs describe-tasks \
     --cluster exchange-layer-dev-cluster \
     --tasks $(aws ecs list-tasks --cluster exchange-layer-dev-cluster --query 'taskArns[0]' --output text)
   ```

### 503 Service Unavailable

1. Health check failing - verify `/api/health` returns 200
2. Container not running - check ECS logs
3. Target group unhealthy - check ALB target group in AWS Console

### Database connection issues

1. Security group allows ECS → RDS on port 5432
2. DATABASE_URL is correctly formatted
3. RDS is in same VPC as ECS

## Files

| File | Description |
|------|-------------|
| `main.tf` | Provider and backend config |
| `variables.tf` | Input variables |
| `vpc.tf` | VPC, subnets, routing |
| `security-groups.tf` | Firewall rules |
| `vpc-endpoints.tf` | Private AWS service access |
| `rds.tf` | PostgreSQL database |
| `ecr.tf` | Container registry |
| `iam.tf` | IAM roles and policies |
| `alb.tf` | Load balancer |
| `ecs.tf` | ECS cluster, task, service |
| `ecs-migration.tf` | Migration task definition |
| `outputs.tf` | Output values |
