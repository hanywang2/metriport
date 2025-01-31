import { Duration, StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import { Construct } from "constructs";
import { EnvConfig } from "./env-config";
import { isProd } from "./util";

interface FhirConverterServiceProps extends StackProps {
  config: EnvConfig;
  version: string | undefined;
}

export function createFHIRConverterService(
  stack: Construct,
  props: FhirConverterServiceProps,
  vpc: ec2.IVpc,
  alarmAction: SnsAction | undefined
): string {
  // Create a new Amazon Elastic Container Service (ECS) cluster
  const cluster = new ecs.Cluster(stack, "FHIRConverterCluster", { vpc });

  // Create a Docker image and upload it to the Amazon Elastic Container Registry (ECR)
  const dockerImage = new ecr_assets.DockerImageAsset(stack, "FHIRConverterImage", {
    directory: "../fhir-converter",
  });

  // Run some servers on fargate containers
  const fargateService = new ecs_patterns.NetworkLoadBalancedFargateService(
    stack,
    "FHIRConverterFargateService",
    {
      cluster: cluster,
      cpu: isProd(props.config) ? 2048 : 1024,
      desiredCount: isProd(props.config) ? 2 : 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
        containerPort: 8080,
        containerName: "FHIRConverter-Server",
        environment: {
          NODE_ENV: "production", // Determines its being run in the cloud, the logical env is set on ENV_TYPE
          ENV_TYPE: props.config.environmentType, // staging, production, sandbox
          ...(props.version ? { METRIPORT_VERSION: props.version } : undefined),
        },
      },
      memoryLimitMiB: isProd(props.config) ? 4096 : 2048,
      healthCheckGracePeriod: Duration.seconds(60),
      publicLoadBalancer: false,
    }
  );
  const serverAddress = fargateService.loadBalancer.loadBalancerDnsName;

  // CloudWatch Alarms and Notifications
  const fargateCPUAlarm = fargateService.service
    .metricCpuUtilization()
    .createAlarm(stack, "FHIRConverterCPUAlarm", {
      threshold: 80,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  alarmAction && fargateCPUAlarm.addAlarmAction(alarmAction);
  alarmAction && fargateCPUAlarm.addOkAction(alarmAction);

  const fargateMemoryAlarm = fargateService.service
    .metricMemoryUtilization()
    .createAlarm(stack, "FHIRConverterMemoryAlarm", {
      threshold: 70,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  alarmAction && fargateMemoryAlarm.addAlarmAction(alarmAction);
  alarmAction && fargateMemoryAlarm.addOkAction(alarmAction);

  // allow the NLB to talk to fargate
  fargateService.service.connections.allowFrom(
    ec2.Peer.ipv4(vpc.vpcCidrBlock),
    ec2.Port.allTraffic(),
    "Allow traffic from within the VPC to the service secure port"
  );
  // TODO: #489 ain't the most secure, but the above code doesn't work as CDK complains we can't use the connections
  // from the cluster created above, should be fine for now as it will only accept connections in the VPC
  fargateService.service.connections.allowFromAnyIpv4(ec2.Port.allTcp());

  // This speeds up deployments so the tasks are swapped quicker.
  // See for details: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html#deregistration-delay
  fargateService.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "17");

  // This also speeds up deployments so the health checks have a faster turnaround.
  // See for details: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/target-group-health-checks.html
  fargateService.targetGroup.configureHealthCheck({
    healthyThresholdCount: 2,
    interval: Duration.seconds(10),
  });

  // hookup autoscaling based on 90% thresholds
  const scaling = fargateService.service.autoScaleTaskCount({
    minCapacity: isProd(props.config) ? 2 : 1,
    maxCapacity: isProd(props.config) ? 10 : 2,
  });
  scaling.scaleOnCpuUtilization("autoscale_cpu", {
    targetUtilizationPercent: 90,
    scaleInCooldown: Duration.minutes(2),
    scaleOutCooldown: Duration.seconds(30),
  });
  scaling.scaleOnMemoryUtilization("autoscale_mem", {
    targetUtilizationPercent: 90,
    scaleInCooldown: Duration.minutes(2),
    scaleOutCooldown: Duration.seconds(30),
  });

  return serverAddress;
}
