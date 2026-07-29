# =============================================================================
# TERRAFORM CONFIGURATION
# =============================================================================
# Exchange Layer - AWS Infrastructure for Coalition X API

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80" # Latest stable as of Jan 2026
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state storage - uncomment after creating S3 bucket & DynamoDB table
  # backend "s3" {
  #   bucket         = "exchange-layer-tf-state"
  #   key            = "exchange-layer/terraform.tfstate"
  #   region         = "eu-central-1"
  #   dynamodb_table = "exchange-layer-tf-lock"
  #   encrypt        = true
  # }
}

# =============================================================================
# AWS PROVIDER
# =============================================================================

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Application = "Coalition X Exchange Layer"
    }
  }
}

# =============================================================================
# DATA SOURCES
# =============================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
